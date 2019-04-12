const TaskMgr = require('./server/tskmgr');
const tm = new TaskMgr();

async function run() {
    await tm.init();
}

run();
