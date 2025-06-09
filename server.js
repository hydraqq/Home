// API для обновления данных
app.post('/api/menu', async (req, res) => {
    try {
        const newData = req.body;
        
        // Сохраняем кошелек отдельно если есть изменения
        if (newData.wallet) {
            try {
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
                console.log('Пропускаем сохранение кошелька');
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
                    scratches: 0,
                    massage: 0,
                    licks: 0
                };
                delete itemData.kissPrice;
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
});// server.js - Сервер с Supabase для постоянного хранения
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
let menuCache = { menu: [], lastUpdated: new Date().toISOString() };

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
        let walletData = { kisses: 10, scratches: 5, massage: 2, licks: 1 };
        
        try {
            const { data: wallet, error: walletError } = await supabase
                .from('wallet')
                .select('*')
                .single();
            
            if (wallet && !walletError) {
                walletData = wallet;
            }
        } catch (e) {
            // Если таблицы нет, используем значения по умолчанию
            console.log('Таблица wallet не найдена, используем значения по умолчанию');
        }
        
        menuCache = {
            menu: menuData || [],
            wallet: walletData,
            lastUpdated: new Date().toISOString()
        };
        
        console.log(`✅ Загружено ${menuData.length} блюд из базы данных`);
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
        database: supabaseUrl ? 'connected' : 'not configured'
    });
});

// Запуск HTTP сервера
const server = app.listen(PORT, () => {
    console.log(`
🍳 Сервер меню запущен на порту ${PORT}!

${process.env.RENDER ? '☁️  Работает на Render.com' : '💻 Локальный режим'}
🗄️  База данных: ${supabaseUrl ? 'Supabase подключен' : 'Не настроен'}
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
