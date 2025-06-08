// server.js - Сервер с Express, WebSocket и Supabase для постоянного хранения данных меню

// --- Зависимости ---
const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// --- Инициализация Express ---
const app = express();
const PORT = process.env.PORT || 3000;

// --- Настройки Supabase ---
// ВАЖНО: Замените на свои реальные данные или используйте переменные окружения (.env файл)
const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project-id.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'your-public-anon-key';
const supabase = createClient(supabaseUrl, supabaseKey);

// --- Кэш данных для быстрой отдачи клиентам ---
let menuCache = {
    menu: [],
    wallet: { kisses: 10, scratches: 5, massage: 2, licks: 1 },
    lastUpdated: new Date().toISOString()
};

// --- Настройка Express Middleware ---
app.use(express.static(__dirname)); // Для отдачи статических файлов (index.html, css, js)
app.use(express.json({ limit: '10mb' })); // Увеличиваем лимит для JSON, например, для изображений в base64

// --- Функции ---

/**
 * Загрузка всех данных (меню и кошелек) из базы данных Supabase в кэш
 */
async function loadFromDatabase() {
    try {
        // 1. Загружаем блюда из 'menu_items'
        const { data: menuData, error: menuError } = await supabase
            .from('menu_items')
            .select('*')
            .order('created_at', { ascending: false });

        if (menuError) throw menuError;

        // 2. Загружаем данные кошелька из 'wallet'
        let walletData = menuCache.wallet; // Значения по умолчанию на случай ошибки
        try {
            const { data: wallet, error: walletError } = await supabase
                .from('wallet')
                .select('*')
                .eq('id', 1) // Предполагаем, что у кошелька всегда id = 1
                .single();

            if (walletError && walletError.code !== 'PGRST116') { // Игнорируем ошибку "не найдено строк"
                console.error('Ошибка при загрузке кошелька:', walletError);
            } else if (wallet) {
                walletData = wallet;
            }
        } catch (e) {
            console.log('Таблица `wallet` не найдена или не настроена, используем значения по умолчанию.');
        }

        // 3. Сохраняем все в кэш
        menuCache = {
            menu: menuData || [],
            wallet: walletData,
            lastUpdated: new Date().toISOString()
        };

        console.log(`✅ Загружено ${menuCache.menu.length} блюд и кошелек из базы данных.`);
    } catch (error) {
        console.error('❌ Критическая ошибка загрузки из БД:', error.message);
    }
}

/**
 * Рассылка обновлений всем подключенным WebSocket клиентам
 * @param {object} message - Объект для отправки
 */
function broadcast(message) {
    const messageStr = JSON.stringify(message);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
}


// --- API Эндпоинты ---

// GET /api/menu: Отдает текущее состояние меню и кошелька из кэша
app.get('/api/menu', (req, res) => {
    res.json(menuCache);
});

// POST /api/menu: Получает новые данные, обновляет БД и кэш, рассылает обновления
app.post('/api/menu', async (req, res) => {
    try {
        const newData = req.body;

        // 1. Обновляем кошелек, если он был изменен
        if (newData.wallet) {
            // Используем 'upsert' для атомарного обновления или создания
            const { error } = await supabase
                .from('wallet')
                .upsert({ id: 1, ...newData.wallet }, { onConflict: 'id' });

            if (error) {
                console.error('Ошибка сохранения кошелька:', error);
                // Не прерываем выполнение, т.к. меню может быть важнее
            }
        }

        const currentIds = menuCache.menu.map(item => item.id);
        const newIds = newData.menu.map(item => item.id);

        // 2. Удаляем элементы, которых нет в новых данных
        const toDelete = currentIds.filter(id => !newIds.includes(id));
        if (toDelete.length > 0) {
            const { error } = await supabase
                .from('menu_items')
                .delete()
                .in('id', toDelete);

            if (error) throw new Error(`Ошибка при удалении: ${error.message}`);
        }

        // 3. Обновляем существующие и добавляем новые элементы
        for (const item of newData.menu) {
            const { id, ...itemData } = item;

            // Миграция со старого формата `kissPrice` на новый `prices`
            if (itemData.kissPrice && !itemData.prices) {
                itemData.prices = {
                    kisses: itemData.kissPrice,
                    scratches: 0,
                    massage: 0,
                    licks: 0
                };
                delete itemData.kissPrice; // Удаляем старое поле
            }

            // Используем 'upsert' для обновления или вставки элемента
            const { error } = await supabase
                .from('menu_items')
                .upsert({ id, ...itemData }, { onConflict: 'id' });

            if (error) throw new Error(`Ошибка при добавлении/обновлении элемента ${id}: ${error.message}`);
        }

        // 4. Обновляем кэш на сервере
        menuCache = {
            menu: newData.menu,
            wallet: newData.wallet || menuCache.wallet,
            lastUpdated: new Date().toISOString()
        };

        // 5. Уведомляем всех клиентов об изменениях
        broadcast({
            type: 'update',
            data: menuCache
        });

        console.log('✅ Данные успешно обновлены и разосланы клиентам.');
        res.json({ success: true, message: 'Данные успешно обновлены' });

    } catch (error) {
        console.error('❌ Ошибка сохранения данных:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /health: Эндпоинт для проверки работоспособности сервера
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        itemsCount: menuCache.menu.length,
        lastUpdated: menuCache.lastUpdated,
        database: supabaseUrl.includes('your-project') ? 'not configured' : 'connected'
    });
});


// --- Запуск сервера ---

// Запускаем HTTP сервер
const server = app.listen(PORT, () => {
    console.log(`\n🍳 Сервер меню запущен на порту ${PORT}!`);
    console.log(`   ${process.env.RENDER ? '☁️  Работает на Render.com' : '💻 Локальный режим'}`);
    console.log(`   🗄️  База данных: ${supabaseUrl.includes('your-project') ? 'Не настроен' : 'Supabase подключен'}\n`);

    // Загружаем данные из БД после запуска сервера
    loadFromDatabase();
});


// --- Настройка WebSocket Server ---
const wss = new WebSocket.Server({ server });
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('✅ Новое устройство подключено. Всего:', clients.size);

    // При подключении сразу отправляем клиенту актуальные данные из кэша
    ws.send(JSON.stringify({
        type: 'init',
        data: menuCache
    }));

    // Пинг для поддержания соединения (важно для PaaS типа Heroku/Render)
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    }, 30000);

    ws.on('close', () => {
        clients.delete(ws);
        clearInterval(pingInterval);
        console.log('❌ Устройство отключено. Осталось:', clients.size);
    });
});

// --- Подписка на изменения в Supabase (Realtime) ---
// Это позволяет синхронизировать данные, даже если они были изменены напрямую в базе
if (!supabaseUrl.includes('your-project')) {
    const subscription = supabase
        .channel('schema-db-changes')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public' },
            async (payload) => {
                console.log('📡 Получено изменение из БД Supabase:', payload.eventType);
                // Перезагружаем все данные, чтобы гарантировать консистентность
                await loadFromDatabase();
                // Рассылаем свежие данные всем клиентам
                broadcast({
                    type: 'update',
                    data: menuCache
                });
            }
        )
        .subscribe();
    console.log('✅ Установлена подписка на изменения в Supabase.');
}
