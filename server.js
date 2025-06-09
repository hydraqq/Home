// server.js - Сервер с Supabase для постоянного хранения
const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase настройки - замените на свои!
const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'your-anon-key';
const supabase = createClient(supabaseUrl, supabaseKey);

// Кэш данных для быстрого доступа
let menuCache = { 
    menu: [], 
    wallet: { kisses: 10, massage: 5, scratches: 2, dishes: 1 },
    lastUpdated: new Date().toISOString() 
};

// Настройка Express
app.use(express.static(__dirname));
app.use(express.json({ limit: '10mb' })); // Увеличиваем лимит для изображений

// Загрузка данных из Supabase при старте
async function loadFromDatabase() {
    try {
        // Загружаем блюда
        const { data: menuData, error: menuError } = await supabase
            .from('menu_items')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (menuError) throw menuError;
        
        // Загружаем кошелек (если есть таблица wallet)
        let walletData = { kisses: 10, massage: 5, scratches: 2, dishes: 1 };
        
        try {
            const { data: wallet, error: walletError } = await supabase
                .from('wallet')
                .select('*')
                .eq('id', 1)
                .single();
            
            if (wallet && !walletError) {
                // Миграция старых данных
                if (wallet.licks !== undefined) {
                    wallet.dishes = wallet.licks;
                    delete wallet.licks;
                }
                walletData = wallet;
            }
        } catch (e) {
            // Если таблицы нет, используем значения по умолчанию
            console.log('Таблица wallet не найдена, используем значения по умолчанию');
        }
        
        // Преобразуем старые данные меню
        if (menuData) {
            menuData.forEach(item => {
                // Миграция старого формата цен
                if (item.kissPrice && !item.prices) {
                    item.prices = {
                        kisses: item.kissPrice,
                        massage: 0,
                        scratches: 0,
                        dishes: 0
                    };
                    delete item.kissPrice;
                }
                
                // Миграция licks в dishes
                if (item.prices && item.prices.licks !== undefined) {
                    item.prices.dishes = item.prices.licks;
                    delete item.prices.licks;
                }
            });
        }
        
        menuCache = {
            menu: menuData || [],
            wallet: walletData,
            lastUpdated: new Date().toISOString()
        };
        
        console.log(`✅ Загружено ${(menuData || []).length} блюд из базы данных`);
    } catch (error) {
        console.error('❌ Ошибка загрузки из БД:', error);
    }
}

// Загружаем данные при старте
loadFromDatabase();

// API для получения данных
app.get('/api/menu', async (req, res) => {
    res.json(menuCache);
});

// API для обновления данных
app.post('/api/menu', async (req, res) => {
    try {
        const newData = req.body;
        
        // Сохраняем кошелек отдельно если есть изменения
        if (newData.wallet) {
            try {
                // Миграция старых данных
                if (newData.wallet.licks !== undefined) {
                    newData.wallet.dishes = newData.wallet.licks;
                    delete newData.wallet.licks;
                }
                
                // Пробуем обновить существующий кошелек
                const { error: updateError } = await supabase
                    .from('wallet')
                    .update(newData.wallet)
                    .eq('id', 1);
                
                if (updateError) {
                    // Если не удалось обновить, создаем новый
                    const { error: insertError } = await supabase
                        .from('wallet')
                        .insert([{ id: 1, ...newData.wallet }]);
                    
                    if (insertError && insertError.code !== '23505') {
                        console.log('Таблица wallet не настроена:', insertError);
                    }
                }
            } catch (e) {
                console.log('Пропускаем сохранение кошелька:', e.message);
            }
        }
        
        // Определяем какие элементы добавить, обновить или удалить
        const currentIds = menuCache.menu.map(item => item.id);
        const newIds = newData.menu.map(item => item.id);
        
        // Удаляем отсутствующие
        const toDelete = currentIds.filter(id => !newIds.includes(id));
        if (toDelete.length > 0) {
            const { error } = await supabase
                .from('menu_items')
                .delete()
                .in('id', toDelete);
            
            if (error) throw error;
        }
        
        // Добавляем или обновляем элементы
        for (const item of newData.menu) {
            const { id, ...itemData } = item;
            
            // Преобразуем старый формат в новый
            if (itemData.kissPrice && !itemData.prices) {
                itemData.prices = {
                    kisses: itemData.kissPrice,
                    massage: 0,
                    scratches: 0,
                    dishes: 0
                };
                delete itemData.kissPrice;
            }
            
            // Миграция licks в dishes
            if (itemData.prices && itemData.prices.licks !== undefined) {
                itemData.prices.dishes = itemData.prices.licks;
                delete itemData.prices.licks;
            }
            
            if (currentIds.includes(id)) {
                // Обновляем существующий
                const { error } = await supabase
                    .from('menu_items')
                    .update(itemData)
                    .eq('id', id);
                
                if (error) throw error;
            } else {
                // Добавляем новый
                const { error } = await supabase
                    .from('menu_items')
                    .insert([{ id, ...itemData }]);
                
                if (error) throw error;
            }
        }
        
        // Обновляем кэш
        menuCache = {
            menu: newData.menu,
            wallet: newData.wallet || menuCache.wallet,
            lastUpdated: new Date().toISOString()
        };
        
        // Уведомляем всех клиентов
        broadcast({
            type: 'update',
            data: menuCache
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Ошибка сохранения:', error);
        res.status(500).json({ error: error.message });
    }
});

// Эндпоинт для проверки здоровья
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        itemsCount: menuCache.menu.length,
        lastUpdated: menuCache.lastUpdated,
        database: supabaseUrl !== 'https://your-project.supabase.co' ? 'connected' : 'not configured'
    });
});

// Запуск HTTP сервера
const server = app.listen(PORT, () => {
    console.log(`
🍳 Сервер меню запущен на порту ${PORT}!

${process.env.RENDER ? '☁️  Работает на Render.com' : '💻 Локальный режим'}
🗄️  База данных: ${supabaseUrl !== 'https://your-project.supabase.co' ? 'Supabase подключен' : 'Не настроен'}
    `);
});

// WebSocket сервер
const wss = new WebSocket.Server({ server });
const clients = new Set();

function broadcast(message) {
    const messageStr = JSON.stringify(message);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
}

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('✅ Новое устройство подключено. Всего:', clients.size);
    
    // Отправляем текущие данные
    ws.send(JSON.stringify({
        type: 'init',
        data: menuCache
    }));
    
    // Пинг для поддержания соединения
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
    
    ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
        clients.delete(ws);
        clearInterval(pingInterval);
    });
});

// Подписка на изменения в реальном времени от Supabase
if (supabaseUrl !== 'https://your-project.supabase.co') {
    const subscription = supabase
        .channel('menu_changes')
        .on('postgres_changes', 
            { 
                event: '*', 
                schema: 'public', 
                table: 'menu_items' 
            }, 
            async (payload) => {
                console.log('📡 Изменение в БД:', payload.eventType);
                // Перезагружаем данные при изменении
                await loadFromDatabase();
                broadcast({
                    type: 'update',
                    data: menuCache
                });
            }
        )
        .subscribe();
}
