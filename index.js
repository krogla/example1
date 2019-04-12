const TaskMgr = require('./tskmgr');
const tm = new TaskMgr();

async function run() {
    await tm.init();
}

run();
