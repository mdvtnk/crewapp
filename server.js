require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT;
const MONGO_URI = process.env.MONGO_URI;
const SECRET_KEY = process.env.SECRET_KEY;

let db;
MongoClient.connect(MONGO_URI)
    .then(client => {
        db = client.db('myDatabase');
        console.log('✅ Подключено к MongoDB');
    })
    .catch(error => console.error('❌ Ошибка подключения к MongoDB:', error));

app.use(cors());
app.use(bodyParser.json());
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

app.post('/register', async (req, res) => {
    try {
        const { fullName, city, email, phone, password } = req.body;
        const usersCollection = db.collection('users');

        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Этот email уже зарегистрирован' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await usersCollection.insertOne({ fullName, city, email, phone, password: hashedPassword });

        res.status(201).json({ message: 'Регистрация успешна' });
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({
            $or: [{ email: username }, { phone: username }]
        });

        if (!user) {
            return res.status(400).json({ message: 'Пользователь не найден' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Неверный пароль' });
        }

        const token = jwt.sign({ userId: user._id }, SECRET_KEY, { expiresIn: '1h' });
        res.json({ message: 'Успешный вход', token });
    } catch (error) {
        console.error('Ошибка авторизации:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.get('/get-profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Нет токена' });

        const decoded = jwt.verify(token, SECRET_KEY);
        const userId = decoded.userId;

        const usersCollection = db.collection('users');
        const crewsCollection = db.collection('crews');
        
        const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });

        const crew = await crewsCollection.findOne({ members: new ObjectId(userId) });

        res.json({
            _id: user._id,
            fullName: user.fullName,
            city: user.city,
            email: user.email,
            phone: user.phone,
            password: user.password,
            crewId: crew ? crew._id : null,
            crewNumber: crew ? crew.crewNumber : null,
            crewStatus: crew ? crew.crewStatus : null
        });
    } catch (error) {
        console.error('Ошибка получения профиля:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.put('/update-profile', async (req, res) => {
    try {
        const { userId, fullName, city, email, phone, password } = req.body;
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        let updatedData = { fullName, city, email, phone };
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            updatedData.password = hashedPassword;
        }

        await usersCollection.updateOne(
            { _id: user._id },
            { $set: updatedData }
        );

        res.json({ message: 'Данные обновлены' });
    } catch (error) {
        console.error('Ошибка обновления профиля:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.post('/update-crew-status', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Нет токена' });
        }

        const decoded = jwt.verify(token, SECRET_KEY);
        const userId = decoded.userId;
        const { crewStatus } = req.body;

        const crewsCollection = db.collection('crews');

        const crew = await crewsCollection.findOne({ 
            members: new ObjectId(userId) 
        });

        if (!crew) {
            return res.status(404).json({ message: 'Бригада не найдена' });
        }

        await crewsCollection.updateOne(
            { _id: crew._id },
            { $set: { crewStatus } }
        );

        res.json({ message: 'Статус бригады обновлён' });
    } catch (error) {
        console.error('Ошибка обновления статуса бригады:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.post('/create-call', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Нет токена' });
        jwt.verify(token, SECRET_KEY);

        const callsCollection = db.collection('calls');
        const callData = req.body;

        if (!callData.address || !callData.callerName || !callData.callerPhone || !callData.priority || !callData.status) {
            return res.status(400).json({ message: 'Отсутствуют обязательные поля' });
        }
        if (!Number.isInteger(callData.victimCount) || callData.victimCount < 1) {
            return res.status(400).json({ message: 'Некорректное количество пострадавших' });
        }
        if (!Array.isArray(callData.victims) || callData.victims.length !== callData.victimCount) {
            return res.status(400).json({ message: 'Количество пострадавших не соответствует данным о них' });
        }

        const lastCall = await callsCollection.find().sort({ callNumber: -1 }).limit(1).toArray();
        const callNumber = lastCall.length > 0 ? lastCall[0].callNumber + 1 : 1;

        callData.callNumber = callNumber;
        callData.createdAt = new Date();
        callData.closedAt = callData.closedAt || null;
        callData.crewId = callData.crewId || null;

        const result = await callsCollection.insertOne(callData);
        res.json({ message: 'Вызов создан', callId: callNumber });
    } catch (error) {
        console.error('Ошибка создания вызова:', error);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

app.get('/get-free-crews', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Нет токена' });
        jwt.verify(token, SECRET_KEY);

        const crewsCollection = db.collection('crews');
        const freeCrews = await crewsCollection.find({ crewStatus: 'Свободна' }).toArray();
        res.json(freeCrews.map(crew => ({ id: crew._id, crewNumber: crew.crewNumber })));
    } catch (error) {
        console.error('Ошибка получения свободных бригад:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.post('/assign-crew-to-call', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Нет токена' });
        jwt.verify(token, SECRET_KEY);

        const { callId, crewId } = req.body;
        const callsCollection = db.collection('calls');
        const crewsCollection = db.collection('crews');

        const call = await callsCollection.findOne({ callNumber: parseInt(callId) });
        if (!call) {
            return res.status(404).json({ message: 'Вызов не найден' });
        }

        const crew = await crewsCollection.findOne({ _id: new ObjectId(crewId) });
        if (!crew) {
            return res.status(404).json({ message: 'Бригада не найдена' });
        }
        if (crew.currentOrder) {
            return res.status(400).json({ message: 'Бригада уже занята другим вызовом' });
        }

        await callsCollection.updateOne(
            { callNumber: parseInt(callId) },
            { $set: { crewId: new ObjectId(crewId) } }
        );

        await crewsCollection.updateOne(
            { _id: new ObjectId(crewId) },
            { $set: { currentOrder: call._id } }
        );

        res.json({ message: 'Бригада назначена' });
    } catch (error) {
        console.error('Ошибка назначения бригады:', error);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

app.get('/get-calls', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Нет токена' });
        jwt.verify(token, SECRET_KEY);

        const callsCollection = db.collection('calls');
        const calls = await callsCollection.find({}).sort({ callNumber: -1 }).toArray();
        res.json(calls.map(call => ({
            ...call,
            _id: call.callNumber
        })));
    } catch (error) {
        console.error('Ошибка получения вызовов:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.get('/get-crew-number/:crewId', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Нет токена' });
        jwt.verify(token, SECRET_KEY);

        const crewsCollection = db.collection('crews');
        const crew = await crewsCollection.findOne({ _id: new ObjectId(req.params.crewId) });
        res.json(crew);
    } catch (error) {
        console.error('Ошибка получения номера бригады:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.get('/get-call/:callId', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Нет токена' });
        jwt.verify(token, SECRET_KEY);

        const callsCollection = db.collection('calls');
        const call = await callsCollection.findOne({ callNumber: parseInt(req.params.callId) });
        if (!call) {
            return res.status(404).json({ message: 'Вызов не найден' });
        }

        res.json({
            ...call,
            _id: call.callNumber
        });
    } catch (error) {
        console.error('Ошибка получения вызова:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

app.put('/update-call/:callId', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Нет токена' });
        jwt.verify(token, SECRET_KEY);

        const callsCollection = db.collection('calls');
        const crewsCollection = db.collection('crews');

        const callId = parseInt(req.params.callId);
        const callData = req.body;
        const currentCall = await callsCollection.findOne({ callNumber: callId });
        if (!currentCall) return res.status(404).json({ message: 'Вызов не найден' });

        if (callData.status === 'Завершён' && currentCall.crewId) {
            callData.closedAt = callData.closedAt || new Date();
            await crewsCollection.updateOne(
                { _id: new ObjectId(currentCall.crewId) },
                { $set: { currentOrder: null, crewStatus: 'Свободна' } }
            );
        } else if (callData.status === 'Ожидание' && currentCall.status === 'Завершён') {
            callData.crewId = null;
            callData.closedAt = null;
            callData.additionalInfo = currentCall.additionalInfo?.replace(/<strong>Завершён:<\/strong>.*?(?=<strong>|$)/, '').trim();
            if (currentCall.crewId) {
                await crewsCollection.updateOne(
                    { _id: new ObjectId(currentCall.crewId) },
                    { $set: { currentOrder: null } }
                );
            }
        } else if (callData.status === 'Ожидание' && currentCall.status === 'В работе') {
            callData.crewId = null;
            if (currentCall.crewId) {
                await crewsCollection.updateOne(
                    { _id: new ObjectId(currentCall.crewId) },
                    { $set: { currentOrder: null, crewStatus: 'Свободна' } }
                );
            }
        }

        const result = await callsCollection.updateOne(
            { callNumber: callId },
            { $set: callData }
        );

        if (result.matchedCount === 0) return res.status(404).json({ message: 'Вызов не найден' });

        res.json({ message: 'Вызов обновлен' });
    } catch (error) {
        console.error('Ошибка обновления вызова:', error);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

app.delete('/delete-call/:callId', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Нет токена' });
        jwt.verify(token, SECRET_KEY);

        const callsCollection = db.collection('calls');
        const crewsCollection = db.collection('crews');

        const callId = parseInt(req.params.callId);
        const call = await callsCollection.findOne({ callNumber: callId });
        if (!call) return res.status(404).json({ message: 'Вызов не найден' });

        if (call.crewId) {
            await crewsCollection.updateOne(
                { _id: new ObjectId(call.crewId) },
                { $set: { currentOrder: null, crewStatus: 'Свободна' } }
            );
        }

        const result = await callsCollection.deleteOne({ callNumber: callId });
        if (result.deletedCount === 0) return res.status(404).json({ message: 'Вызов не найден' });

        res.json({ message: 'Вызов удален' });
    } catch (error) {
        console.error('Ошибка удаления вызова:', error);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

app.listen(PORT, () => console.log(`🚀 Сервер запущен на http://localhost:${PORT}`));