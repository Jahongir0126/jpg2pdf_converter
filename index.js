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
    bot.sendMessage(chatId, 'Salom! Menga bir yoki bir nechta rasm yuboring, men ularni PDF formatiga o\'zgartiraman.');
});

// Обработка получения изображений
bot.on('photo', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        // Проверяем формат изображения
        const photo = msg.photo[msg.photo.length - 1];
        if (!photo) {
            throw new Error('Noto\'g\'ri rasm formati');
        }

        const fileId = photo.file_id;
        const file = await bot.getFile(fileId);
        
        if (!file || !file.file_path) {
            throw new Error('Faylni yuklab bo\'lmadi');
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
            throw new Error('Rasm hajmi juda katta');
        }

        if (!userImages.has(userId)) {
            userImages.set(userId, []);
        }
        userImages.get(userId).push(imageBuffer);

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'PDF yaratish', callback_data: 'convert' }]
                ]
            }
        };

        await bot.sendMessage(chatId, 
            `Rasm qabul qilindi! Jami rasmlar soni: ${userImages.get(userId).length}`, 
            keyboard);
    } catch (error) {
        console.error('Rasmni qayta ishlashda xatolik:', error);
        await bot.sendMessage(msg.chat.id, 
            `Rasmni qayta ishlashda xatolik yuz berdi: ${error.message}. Iltimos, qaytadan urinib ko'ring.`);
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
                return bot.sendMessage(chatId, 'Avval kamida bitta rasm yuborishingiz kerak!');
            }

            await bot.sendMessage(chatId, 'PDF yaratish boshlandi...');
            
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
                    console.error('PDFga rasm qo\'shishda xatolik:', error);
                    throw new Error('Rasmlardan birini qayta ishlashda xatolik yuz berdi');
                }
            }
            
            const pdfBytes = await pdfDoc.save();
            
            pdfPath = `${tempDir}/temp_${userId}_${Date.now()}.pdf`;
            fs.writeFileSync(pdfPath, pdfBytes);
            
            await bot.sendDocument(chatId, pdfPath, {
                caption: 'PDF faylingiz tayyor!'
            });
            
            await bot.answerCallbackQuery(query.id, {
                text: 'PDF muvaffaqiyatli yaratildi!'
            });
            
        } catch (error) {
            console.error('PDF yaratishda xatolik:', error);
            await bot.answerCallbackQuery(query.id, {
                text: 'Xatolik yuz berdi!',
                show_alert: true
            });
            await bot.sendMessage(chatId, 
                `PDF yaratishda xatolik yuz berdi: ${error.message}. Iltimos, qaytadan urinib ko'ring.`);
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

console.log('Bot ishga tushdi!');
