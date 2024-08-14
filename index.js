const express = require('express');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const WebSocket = require('ws');
const app = express();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const Database = require("@replit/database");
const db = new Database();

const port = process.env.PORT || 3000;
const wss = new WebSocket.Server({
    noServer: true
});

const key = "storage";
var server_storage = [];
var user_files = [];
var processingQueue = []; // Queue to hold songs for processing

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', './index.html'));
});

app.get('/reset-db', (req, res) => {
    cleanDB();
    console.log("Cleaned database!");
    res.send("Server Hath Been Purged");
});

app.get('/expose-db', (req, res) => {
    res.send(server_storage);
});

app.get('/audio/:folder/:fileName', (req, res) => {
    const folderName = req.params.folder;
    const fileName = req.params.fileName;
    const filePath = path.join(__dirname, 'public', 'media', folderName, fileName);

    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            res.status(404).send('File not found');
        } else {
            res.sendFile(filePath);
        }
    });
});

// Start the server
const server = http.createServer(app);

server.listen(port, () => {
    const protocol = server instanceof https.Server ? 'https' : 'http';
    const host = server.address().address;
    const port = server.address().port;
    const clientUrl = `${protocol}://${host === '::' ? 'localhost' : host}:${port}`;

    console.log(`Server is listening on ${clientUrl}`);

    // WebSocket upgrade
    server.on('upgrade', (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });

    wss.on('connection', (ws, req) => {
        console.log('Client connected via WebSocket');

        db.get(key).then(promise => {
            if (promise) {
                promise.forEach(item => server_storage.push(item));
            }
            console.log(server_storage);
        });

        server_storage = [...new Set(server_storage)];

        server_storage.forEach(values => {
            processingQueue.push(values);
        });

        async function processQueue() {
            const newQueue = [];

            for (const values of processingQueue) {
                const valuesArr = values.split("%17");
                const url = `${clientUrl}${valuesArr[1]}`;
                try {
                    const response = await new Promise((resolve, reject) => {
                        https.get(url, response => resolve(response)).on('error', reject);
                    });

                    if (response.statusCode === 200) {
                        ws.send(JSON.stringify({
                            success: "done",
                            link: valuesArr[1],
                            text_content: valuesArr[0]
                        }));
                        valuesArr.processed = true; // Mark as processed
                    } else {
                        console.log(`File extension <${valuesArr[1]}> does not exist.`);
                        cleanDB();
                    }
                } catch (error) {
                    console.error('Error:', error.message);
                }

                if (!valuesArr.processed) {
                    newQueue.push(values);
                }
            }
            processingQueue = newQueue; // Update queue
        }

        processQueue();

        ws.on('message', (message) => {
            console.log('Received:', message);
        });

        ws.on('close', () => {
            console.log('Client disconnected');
        });
    });
});

// Audio conversion WebSocket logic
wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        const videoUrl = data.url;
        const title = data.title;

        if (!videoUrl || !title) {
            ws.send(JSON.stringify({ error: 'Invalid URL or missing title' }));
            return;
        }

        try {
            const mp3FileName = "audio.mp3";
            const outputPath = path.join(__dirname, 'public', 'media', title, mp3FileName);
            checkAndCreateFolder(path.join(__dirname, 'public', 'media', title));

            const videoInfo = await ytdl.getInfo(videoUrl);
            const audioStream = ytdl(videoUrl, { quality: 'highestaudio' });

            const process = ffmpeg()
                .input(audioStream)
                .format('mp3')
                .audioBitrate('128k')
                .save(outputPath);

            process.on('end', () => {
                console.log('Conversion completed');
                const fileLink = `/audio/${encodeURIComponent(title)}/${mp3FileName}`;
                user_files.push(`${title}%17${fileLink}`);
                ws.send(JSON.stringify({ success: "done", link: fileLink, text_content: `${title}` }));
                clientCleanUp();
            });

            process.on('error', (error) => {
                console.error('Error converting the audio:', error);
                ws.send(JSON.stringify({ error: 'Error converting the audio' }));
            });
        } catch (error) {
            console.error('Error:', error);
            ws.send(JSON.stringify({ error: 'Error converting the video' }));
        }
    });
});

function checkAndCreateFolder(folderPath) {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        console.log('Folder created successfully:', folderPath);
    } else {
        console.log('Folder already exists:', folderPath);
    }
}

function clientCleanUp() {
    user_files.forEach(value => {
        if (!server_storage.includes(value)) {
            server_storage.push(value);
        }
    });

    server_storage = [...new Set(server_storage)];
    db.set(key, server_storage);
    user_files = [];
}

function cleanDB() {
    db.set(key, []);
    user_files = [];
}
