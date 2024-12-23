require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { PDFDocument } = require('pdf-lib');
const fetch = require('node-fetch');
const fs = require('fs');

// Используем токен из .env файла
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, {polling: true});

// Хранение изображений для каждого пользователя
const userImages = new Map();

// В начале файла добавим создание временной директории
const tempDir = 'temp';
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Привет! Отправь мне одно или несколько изображений, и я конвертирую их в PDF.');
});

// Обработка получения изображений
bot.on('photo', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        // Проверяем формат изображения
        const photo = msg.photo[msg.photo.length - 1];
        if (!photo) {
            throw new Error('Неверный формат изображения');
        }

        const fileId = photo.file_id;
        const file = await bot.getFile(fileId);
        
        if (!file || !file.file_path) {
            throw new Error('Не удалось получить файл');
        }

        const imageUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        
        // Загружаем изображение с таймаутом
        const imageResponse = await fetch(imageUrl, { timeout: 10000 });
        if (!imageResponse.ok) {
            throw new Error(`Ошибка загрузки изображения: ${imageResponse.status}`);
        }
        
        const imageBuffer = await imageResponse.buffer();
        
        // Проверяем размер изображения
        if (imageBuffer.length > 20 * 1024 * 1024) { // 20MB limit
            throw new Error('Изображение слишком большое');
        }

        if (!userImages.has(userId)) {
            userImages.set(userId, []);
        }
        userImages.get(userId).push(imageBuffer);

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Создать PDF', callback_data: 'convert' }]
                ]
            }
        };

        await bot.sendMessage(chatId, 
            `Изображение получено! Всего изображений: ${userImages.get(userId).length}`, 
            keyboard);
    } catch (error) {
        console.error('Ошибка при обработке фото:', error);
        await bot.sendMessage(msg.chat.id, 
            `Произошла ошибка при обработке изображения: ${error.message}. Пожалуйста, попробуйте снова.`);
    }
});

// Обработчик callback_query
bot.on('callback_query', async (query) => {
    if (query.data === 'convert') {
        const msg = query.message;
        const chatId = msg.chat.id;
        const userId = query.from.id;
        let pdfPath = null;
        
        try {
            if (!userImages.has(userId) || userImages.get(userId).length === 0) {
                await bot.answerCallbackQuery(query.id);
                return bot.sendMessage(chatId, 'Сначала отправьте хотя бы одно изображение!');
            }

            await bot.sendMessage(chatId, 'Начинаю создание PDF...');
            
            const pdfDoc = await PDFDocument.create();
            
            for (const imageBuffer of userImages.get(userId)) {
                try {
                    const image = await pdfDoc.embedJpg(imageBuffer);
                    const page = pdfDoc.addPage([image.width, image.height]);
                    page.drawImage(image, {
                        x: 0,
                        y: 0,
                        width: image.width,
                        height: image.height,
                    });
                } catch (error) {
                    console.error('Ошибка при добавлении изображения в PDF:', error);
                    throw new Error('Не удалось обработать одно из изображений');
                }
            }
            
            const pdfBytes = await pdfDoc.save();
            
            pdfPath = `${tempDir}/temp_${userId}_${Date.now()}.pdf`;
            fs.writeFileSync(pdfPath, pdfBytes);
            
            await bot.sendDocument(chatId, pdfPath, {
                caption: 'Ваш PDF файл готов!'
            });
            
            await bot.answerCallbackQuery(query.id, {
                text: 'PDF успешно создан!'
            });
            
        } catch (error) {
            console.error('Ошибка при создании PDF:', error);
            await bot.answerCallbackQuery(query.id, {
                text: 'Произошла ошибка!',
                show_alert: true
            });
            await bot.sendMessage(chatId, 
                `Произошла ошибка при создании PDF: ${error.message}. Пожалуйста, попробуйте снова.`);
        } finally {
            if (pdfPath && fs.existsSync(pdfPath)) {
                try {
                    fs.unlinkSync(pdfPath);
                } catch (error) {
                    console.error('Ошибка при удалении временного файла:', error);
                }
            }
            userImages.delete(userId);
        }
    }
});

// Добавляем обработку ошибок для самого бота
bot.on('error', (error) => {
    console.error('Ошибка бота:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Необработанная ошибка:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Необработанное отклонение промиса:', error);
});

console.log('Бот запущен!');
