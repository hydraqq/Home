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
    wallet: { kisses: 10, scratches: 5, massage: 2, licks: 1 },
    lastUpdated: new Date().toISOString() 
};

// Настройка Express
app.use(express.static(__dirname));
app.use(express.json({ limit: '10mb' }));

// Обработка ошибок WebSocket
process.on('uncaughtException', (error) => {
    console.error('Необработанная ошибка:', error);
});

// Загрузка данных из Supabase при старте
async function loadFromDatabase() {
    try {
        // Загружаем блюда
        const { data: menuData, error: menuError } = await supabase
            .from('menu_items')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (menuError && menuError.code !== 'PGRST116') {
            console.log('Ошибка загрузки меню:', menuError);
        }
        
        // Загружаем кошелек
        let walletData = { kisses: 10, scratches: 5, massage: 2, licks: 1 };
        
        try {
            const { data: wallet, error: walletError } = await supabase
                .from('wallet')
                .select('*')
                .eq('id', 1)
                .single();
            
            if (wallet && !walletError) {
                // Миграция старых данных licks в dishes и обратно в licks
                if (wallet.dishes !== undefined && wallet.licks === undefined) {
                    wallet.licks = wallet.dishes;
                    delete wallet.dishes;
                }
                walletData = wallet;
            }
        } catch (e) {
            console.log('Таблица wallet не найдена, используем значения по умолчанию');
        }
        
        // Преобразуем старые данные меню
        if (menuData) {
            menuData.forEach(item => {
                // Миграция старого формата цен
                if (item.kissPrice && !item.prices) {
                    item.prices = {
                        kisses: item.kissPrice,
                        scratches: 0,
                        massage: 0,
                        licks: 0
                    };
                    delete item.kissPrice;
                }
                
                // Миграция dishes в licks для обратной совместимости
                if (item.prices && item.prices.dishes !== undefined) {
                    item.prices.licks = item.prices.dishes;
                    delete item.prices.dishes;
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
                // Миграция dishes в licks для совместимости
                if (newData.wallet.dishes !== undefined && newData.wallet.licks === undefined) {
                    newData.wallet.licks = newData.wallet.dishes;
                    delete newData.wallet.dishes;
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
        
        // Обрабатываем меню только если есть изменения
        if (newData.menu) {
            const currentIds = menuCache.menu.map(item => item.id);
            const newIds = newData.menu.map(item => item.id);
            
            // Удаляем отсутствующие
            const toDelete = currentIds.filter(id => !newIds.includes(id));
            if (toDelete.length > 0) {
                try {
                    const { error } = await supabase
                        .from('menu_items')
                        .delete()
                        .in('id', toDelete);
                    
                    if (error) console.log('Ошибка удаления:', error);
                } catch (e) {
                    console.log('Пропускаем удаление из БД');
                }
            }
            
            // Добавляем или обновляем элементы
            for (const item of newData.menu) {
                const { id, ...itemData } = item;
                
                // Преобразуем старый формат в новый
                if (itemData.kissPrice && !itemData.prices) {
                    itemData.prices = {
                        kisses: itemData.kissPrice,
                        scratches: 0,
                        massage: 0,
                        licks: 0
                    };
                    delete itemData.kissPrice;
                }
                
                // Миграция dishes в licks
                if (itemData.prices && itemData.prices.dishes !== undefined) {
                    itemData.prices.licks = itemData.prices.dishes;
                    delete itemData.prices.dishes;
                }
                
                try {
                    if (currentIds.includes(id)) {
                        // Обновляем существующий
                        const { error } = await supabase
                            .from('menu_items')
                            .update(itemData)
                            .eq('id', id);
                        
                        if (error) console.log('Ошибка обновления:', error);
                    } else {
                        // Добавляем новый
                        const { error } = await supabase
                            .from('menu_items')
                            .insert([{ id, ...itemData }]);
                        
                        if (error) console.log('Ошибка добавления:', error);
                    }
                } catch (e) {
                    console.log('Пропускаем операцию с БД для элемента:', id);
                }
            }
        }
        
        // Обновляем кэш
        menuCache = {
            menu: newData.menu || menuCache.menu,
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
const wss = new WebSocket.Server({ 
    server,
    perMessageDeflate: false,
    clientTracking: true
});

const clients = new Set();

function broadcast(message) {
    if (clients.size === 0) return;
    
    const messageStr = JSON.stringify(message);
    const deadClients = new Set();
    
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(messageStr);
            } catch (error) {
                console.log('Ошибка отправки сообщения клиенту:', error.message);
                deadClients.add(client);
            }
        } else {
            deadClients.add(client);
        }
    });
    
    // Удаляем мертвые соединения
    deadClients.forEach(client => clients.delete(client));
}

wss.on('connection', (ws, req) => {
    clients.add(ws);
    console.log(`✅ Новое устройство подключено. Всего: ${clients.size}`);
    
    // Отправляем текущие данные
    try {
        ws.send(JSON.stringify({
            type: 'init',
            data: menuCache
        }));
    } catch (error) {
        console.log('Ошибка отправки начальных данных:', error.message);
    }
    
    // Пинг для поддержания соединения
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.ping();
            } catch (error) {
                console.log('Ошибка ping:', error.message);
                clearInterval(pingInterval);
                clients.delete(ws);
            }
        } else {
            clearInterval(pingInterval);
            clients.delete(ws);
        }
    }, 30000);
    
    ws.on('close', () => {
        clients.delete(ws);
        clearInterval(pingInterval);
        console.log(`❌ Устройство отключено. Осталось: ${clients.size}`);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error.message);
        clients.delete(ws);
        clearInterval(pingInterval);
    });
    
    ws.on('pong', () => {
        // Клиент ответил на ping
    });
});

// Подписка на изменения в реальном времени от Supabase
if (supabaseUrl !== 'https://your-project.supabase.co') {
    try {
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
    } catch (error) {
        console.log('Не удалось подписаться на изменения Supabase:', error.message);
    }
}
