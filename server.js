require('dotenv').config();
const express = require('express');
const db = require('./db/database');
const matchesRouter = require('./routes/matches');
const playersRouter = require('./routes/players');

const app = express();
app.set('json spaces', 2);
app.use(express.json());
app.use(express.static('./public'));
app.get('/health', (req, res) => {
    res.json({ ok: true });
});
app.use('/api/matches', matchesRouter);
app.use('/api/players', playersRouter);

const PORT = process.env.PORT || 3000;

function startServer() {
    const server = app.listen(PORT, () => {
        console.log(`App server running at http://localhost:${PORT}`);
    });

    server.on('error', (err) => {
        console.error(`앱 서버를 시작할 수 없습니다: ${err.message}`);
        db.close();
        process.exitCode = 1;
    });

    let isShuttingDown = false;
    const shutdown = () => {
        if (isShuttingDown) {
            return;
        }
        isShuttingDown = true;

        server.close((err) => {
            if (err) {
                console.error(`앱 서버를 종료할 수 없습니다: ${err.message}`);
                process.exitCode = 1;
            }
            db.close();
        });
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };