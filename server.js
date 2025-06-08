// server.js - Обновленный сервер с поддержкой валют
const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Расширенное хранилище данных в памяти
let menuData = { 
    menu: [],
    currencies: {
        kiss: 10,      // Начальные валюты для тестирования
        massage: 5,
        scratch: 8,
        lick: 3
    },
    tasks: {
        kiss: 0,
        massage: 0,
        scratch: 0,
        lick: 0
    },
    selectedDishes: [],
    lastUpdated: new Date().toISOString()
};

// Настройка Express
app.use(express.static(__dirname));
app.use(express.json());

// API для получения данных
app.get('/api/menu', (req, res) => {
    res.json(menuData);
});

// API для обновления данных
app.post('/api/menu', (req, res) => {
    // Обеспечиваем совместимость со старыми клиентами
    const newData = req.body;
    
    menuData = {
        menu: newData.menu || menuData.menu,
        currencies: newData.currencies || menuData.currencies,
        tasks: newData.tasks || menuData.tasks,
        selectedDishes: newData.selectedDishes || menuData.selectedDishes,
        lastUpdated: new Date().toISOString()
    };
    
    // Уведомляем всех подключенных клиентов
    broadcast({
        type: 'update',
        data: menuData
    });
    
    res.json({ success: true });
});

// API для работы с валютами
app.post('/api/currencies', (req, res) => {
    const { type, amount } = req.body;
    
    if (menuData.currencies.hasOwnProperty(type)) {
        menuData.currencies[type] = Math.max(0, menuData.currencies[type] + amount);
        menuData.lastUpdated = new Date().toISOString();
        
        broadcast({
            type: 'update',
            data: menuData
        });
        
        res.json({ success: true, currencies: menuData.currencies });
    } else {
        res.status(400).json({ error: 'Invalid currency type' });
    }
});

// API для работы с заданиями
app.post('/api/tasks', (req, res) => {
    const { type } = req.body;
    
    if (menuData.tasks.hasOwnProperty(type)) {
        menuData.tasks[type] = (menuData.tasks[type] || 0) + 1;
        // Автоматически добавляем валюту за выполненное задание
        menuData.currencies[type] = (menuData.currencies[type] || 0) + 1;
        menuData.lastUpdated = new Date().toISOString();
        
        broadcast({
            type: 'update',
            data: menuData
        });
        
        res.json({ 
            success: true, 
            tasks: menuData.tasks,
            currencies: menuData.currencies 
        });
    } else {
        res.status(400).json({ error: 'Invalid task type' });
    }
});

// API для работы с заказами
app.post('/api/order', (req, res) => {
    const { action, dishId } = req.body;
    
    if (action === 'add' && dishId) {
        if (!menuData.selectedDishes.includes(dishId)) {
            menuData.selectedDishes.push(dishId);
        }
    } else if (action === 'remove' && dishId) {
        menuData.selectedDishes = menuData.selectedDishes.filter(id => id !== dishId);
    } else if (action === 'process') {
        // Обработка заказа
        const totalCost = {
            kiss: 0, massage: 0, scratch: 0, lick: 0
        };

        // Подсчитываем общую стоимость
        menuData.selectedDishes.forEach(dishId => {
            const dish = menuData.menu.find(item => item.id === dishId);
            if (dish) {
                totalCost.kiss += dish.kissPrice || 0;
                totalCost.massage += dish.massagePrice || 0;
                totalCost.scratch += dish.scratchPrice || 0;
                totalCost.lick += dish.lickPrice || 0;
            }
        });

        // Проверяем достаточность средств
        for (let currency in totalCost) {
            if (totalCost[currency] > menuData.currencies[currency]) {
                return res.status(400).json({ 
                    error: 'Insufficient funds',
                    currency: currency,
                    needed: totalCost[currency],
                    available: menuData.currencies[currency]
                });
            }
        }

        // Списываем валюту
        for (let currency in totalCost) {
            menuData.currencies[currency] -= totalCost[currency];
        }

        // Очищаем заказ
        menuData.selectedDishes = [];
        menuData.lastUpdated = new Date().toISOString();
        
        broadcast({
            type: 'update',
            data: menuData
        });
        
        return res.json({ 
            success: true, 
            message: 'Order processed successfully',
            totalCost: totalCost,
            remainingCurrencies: menuData.currencies
        });
    }
    
    menuData.lastUpdated = new Date().toISOString();
    
    broadcast({
        type: 'update',
        data: menuData
    });
    
    res.json({ success: true, selectedDishes: menuData.selectedDishes });
});

// Эндпоинт для проверки здоровья
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        itemsCount: menuData.menu.length,
        currencies: menuData.currencies,
        tasksCompleted: Object.values(menuData.tasks).reduce((a, b) => a + b, 0),
        lastUpdated: menuData.lastUpdated
    });
});

// Эндпоинт для получения статистики
app.get('/api/stats', (req, res) => {
    const totalDishes = menuData.menu.length;
    const totalTasks = Object.values(menuData.tasks).reduce((a, b) => a + b, 0);
    const totalCurrencies = Object.values(menuData.currencies).reduce((a, b) => a + b, 0);
    const pendingOrders = menuData.selectedDishes.length;
    
    res.json({
        totalDishes,
        totalTasks,
        totalCurrencies,
        pendingOrders,
        currencies: menuData.currencies,
        tasks: menuData.tasks,
        lastUpdated: menuData.lastUpdated
    });
});

// Эндпоинт для сброса данных (для отладки)
app.post('/api/reset', (req, res) => {
    const { confirm } = req.body;
    
    if (confirm === 'RESET_ALL_DATA') {
        menuData = {
            menu: [],
            currencies: {
                kiss: 10,
                massage: 5,
                scratch: 8,
                lick: 3
            },
            tasks: {
                kiss: 0,
                massage: 0,
                scratch: 0,
                lick: 0
            },
            selectedDishes: [],
            lastUpdated: new Date().toISOString()
        };
        
        broadcast({
            type: 'update',
            data: menuData
        });
        
        res.json({ success: true, message: 'All data has been reset' });
    } else {
        res.status(400).json({ error: 'Invalid confirmation code' });
    }
});

// Запуск HTTP сервера
const server = app.listen(PORT, () => {
    console.log(`
🍳 Расширенный сервер меню запущен на порту ${PORT}!

${process.env.RENDER ? '☁️  Работает на Render.com' : '💻 Локальный режим'}

💰 Валютная система активна
📝 Система заданий активна
🛒 Система заказов активна
✏️  Редактирование блюд активно

Текущий баланс валют:
💋 Поцелуйчики: ${menuData.currencies.kiss}
💆 Массажики: ${menuData.currencies.massage}
🤗 Почухушки: ${menuData.currencies.scratch}
👅 Лизуны: ${menuData.currencies.lick}
    `);
});

// WebSocket сервер для real-time синхронизации
const wss = new WebSocket.Server({ server });

// Хранение активных подключений
const clients = new Set();

// Отправка сообщения всем клиентам
function broadcast(message) {
    const messageStr = JSON.stringify(message);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(messageStr);
            } catch (error) {
                console.error('Ошибка отправки сообщения клиенту:', error);
            }
        }
    });
}

// Обработка WebSocket подключений
wss.on('connection', (ws, req) => {
    clients.add(ws);
    console.log('✅ Новое устройство подключено. Всего:', clients.size);
    console.log('   IP:', req.socket.remoteAddress);
    
    // Отправляем текущие данные новому клиенту
    try {
        ws.send(JSON.stringify({
            type: 'init',
            data: menuData
        }));
    } catch (error) {
        console.error('Ошибка отправки начальных данных:', error);
    }
    
    // Пинг для поддержания соединения
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.ping();
            } catch (error) {
                console.error('Ошибка пинга:', error);
            }
        }
    }, 30000);
    
    // Обработка сообщений от клиента
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Получено сообщение от клиента:', data.type || 'unknown');
            
            // Здесь можно обрабатывать специальные команды от клиента
            if (data.type === 'heartbeat') {
                ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения от клиента:', error);
        }
    });
    
    ws.on('close', (code, reason) => {
        clients.delete(ws);
        clearInterval(pingInterval);
        console.log('❌ Устройство отключено. Осталось:', clients.size);
        console.log('   Код:', code, 'Причина:', reason.toString());
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
        clients.delete(ws);
        clearInterval(pingInterval);
    });
    
    ws.on('pong', () => {
        // Клиент ответил на пинг - соединение активно
    });
});

// Функция для предотвращения засыпания на Render
if (process.env.RENDER) {
    setInterval(() => {
        const stats = {
            uptime: Math.floor(process.uptime()),
            clients: clients.size,
            dishes: menuData.menu.length,
            totalCurrency: Object.values(menuData.currencies).reduce((a, b) => a + b, 0),
            totalTasks: Object.values(menuData.tasks).reduce((a, b) => a + b, 0)
        };
        console.log('💓 Сервер активен:', new Date().toLocaleString(), stats);
    }, 5 * 60 * 1000); // каждые 5 минут
}

// Обработка ошибок сервера
process.on('uncaughtException', (error) => {
    console.error('❌ Необработанная ошибка:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Необработанное отклонение промиса:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Получен сигнал SIGTERM, завершаем работу...');
    
    // Уведомляем всех клиентов о завершении работы
    broadcast({
        type: 'server_shutdown',
        message: 'Сервер завершает работу'
    });
    
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});

process.on('SIGINT', () => {
    console.log('🛑 Получен сигнал SIGINT, завершаем работу...');
    
    broadcast({
        type: 'server_shutdown',
        message: 'Сервер завершает работу'
    });
    
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});
