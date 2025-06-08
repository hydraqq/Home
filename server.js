// server.js - Сервер для облачного хостинга
const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Хранилище данных в памяти (для Render.com)
// Данные будут сохраняться пока сервер активен
let menuData = { 
    menu: [],
    lastUpdated: new Date().toISOString()
};

// Для постоянного хранения можно использовать бесплатную MongoDB
// или PostgreSQL от Render, но для простоты используем память

// Настройка Express
app.use(express.static(__dirname));
app.use(express.json());

// API для получения данных
app.get('/api/menu', (req, res) => {
    res.json(menuData);
});

// API для обновления данных
app.post('/api/menu', (req, res) => {
    menuData = {
        ...req.body,
        lastUpdated: new Date().toISOString()
    };
    
    // Уведомляем всех подключенных клиентов
    broadcast({
        type: 'update',
        data: menuData
    });
    
    res.json({ success: true });
});

// Эндпоинт для проверки здоровья (чтобы сервер не засыпал)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        itemsCount: menuData.menu.length,
        lastUpdated: menuData.lastUpdated
    });
});

// Запуск HTTP сервера
const server = app.listen(PORT, () => {
    console.log(`
🍳 Сервер меню запущен на порту ${PORT}!

${process.env.RENDER ? '☁️  Работает на Render.com' : '💻 Локальный режим'}
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
            client.send(messageStr);
        }
    });
}

// Обработка WebSocket подключений
wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('✅ Новое устройство подключено. Всего:', clients.size);
    
    // Отправляем текущие данные новому клиенту
    ws.send(JSON.stringify({
        type: 'init',
        data: menuData
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
    });
});

// Функция для предотвращения засыпания на Render
// (опционально - можно использовать внешний сервис для пинга)
if (process.env.RENDER) {
    setInterval(() => {
        console.log('💓 Сервер активен:', new Date().toLocaleString());
    }, 5 * 60 * 1000); // каждые 5 минут
}