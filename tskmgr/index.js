const debug = require('debug')('tskmgr:');

const fs = require('fs');
const path = require('path');
const basename = path.basename(__filename);

const Queue = require('bull');
// const db = require('../../server/models');

const jobsConfig = require('../config')['jobs'];

class Rater {

    constructor() {
        this.queues = {};
        this.workers = {};
    }

    async init() {
        // init all queues first
        fs.readdirSync(__dirname).filter(file => {
            return (file.indexOf('.') !== 0) && (file !== basename) && (file.slice(-3) === '.js');
        }).forEach(file => {
            const queueName = file.slice(0, -3);
            if (!jobsConfig[queueName] || jobsConfig[queueName].disabled) {
                return;
            }

            this.queues[queueName] = new Queue(queueName);
            this.workers[queueName] = require(path.join(__dirname, file))(this, queueName, jobsConfig[queueName]);
            //clean queue
            this.clean(queueName)
                .then(() => {
                    if (this.workers[queueName].onError) {
                        this.queues[queueName].on('error', this.workers[queueName].onError);
                    } else {
                        this.queues[queueName].on('error', e => {
                            // An error occured.
                            debug(e);
                        });
                    }
                    // if (this.workers[queueName].onReady) {
                    //   this.queues[queueName].on('ready', this.workers[queueName].onReady);
                    // }
                    // if (this.workers[queueName].onActive) {
                    //   this.queues[queueName].on('active', this.workers[queueName].onActive);
                    // }
                    // if (this.workers[queueName].onCompleted) {
                    //   this.queues[queueName].on('completed', this.workers[queueName].onCompleted);
                    // }
                    if (this.workers[queueName].onFailed) {
                        this.queues[queueName].on('failed', this.workers[queueName].onFailed);
                    } else {
                        this.queues[queueName].on('failed', (job, err) => {
                            // A job failed with reason `err`!
                            debug('job failed:', job.queue.name, 'err:', err);
                        });
                    }
                    this.queues[queueName].process(this.workers[queueName].job);
                    if (this.workers[queueName].start) {
                        debug('start', queueName);
                        this.workers[queueName].start();
                    }
                });
        });
    }

    pushJob(queueName, data = {}, opts = {
        removeOnComplete: true,
    }) {
        // debug('new job', queueName, data)
        let cfgOpts = jobsConfig[queueName] ? jobsConfig[queueName].JobOpts || {} : {};
        return this.queues[queueName].add(data, {...cfgOpts, ...opts});
    }

    async clean(queueName, opts = {}) {
        // await this.queues[queueName].clean()
        let clean = this.queues[queueName].clean.bind(this.queues[queueName], 0);

        await this.queues[queueName].pause()
                                    .then(clean('completed'))
                                    .then(clean('active'))
                                    .then(clean('delayed'))
                                    .then(clean('failed'))
                                    .then(() => {
                                        return this.queues[queueName].empty();
                                        // })
                                        // .then(function () {
                                        //   return job.queue.close();
                                    });

        await this.queues[queueName].empty();
        if (await this.queues[queueName].getRepeatableCount() > 0) {
            await this.queues[queueName].removeRepeatable(jobsConfig[queueName].JobOpts.repeat || {});
        }
    }
}

module.exports = Rater;
