require('dotenv').config();

const app_config = require('../resources/js/store/config');
let env = process.env.NODE_ENV || 'development';
let prefix = process.env.MIX_BROADCAST_PREFIX || '';

let config = {
    local: {
        db: {
            database: process.env.DB_DATABASE,
            username: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            dialect: 'mysql',
            define: {
                underscored: true,
            },
            dialectOptions: {
                // useUTC: true, //for reading from database
                timezone: '+00:00',
            },
            timezone: '+00:00', //for writing to database
        },
    },
    development: {
        db: {
            database: process.env.DB_DATABASE,
            username: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            dialect: 'mysql',
            define: {
                underscored: true,
            },
            dialectOptions: {
                // useUTC: true, //for reading from database
                timezone: '+00:00',
            },
            timezone: '+00:00', //for writing to database
        },
    },
    production: {
        db: {
            database: process.env.DB_DATABASE,
            username: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            dialect: 'mysql',
            logging: false,
            define: {
                underscored: true,
            },
            dialectOptions: {
                // useUTC: true, //for reading from database
                timezone: '+00:00',
            },
            timezone: '+00:00', //for writing to database
        },
    },

    _shared: {
        app: app_config,
        jobs: {
            cmc_grabber: {
                disabled: false,
                backOffset: 3,
                blockCnt: 3,
                JobOpts: {
                    repeat: {
                        every: 5000,
                    },
                },
            },
            bet_syncer: {
                disabled: true,
                backOffset: 3,
                blockCnt: 500,
                JobOpts: {
                    repeat: {
                        every: 30000,
                    },
                },
            },
            bot_reply: {
                disabled: false,
                JobOpts: {
                    repeat: {
                        every: 40000,
                    },
                },
            },
        },
        key: {
            infura: process.env.INFURA_KEY,
            etherscan: process.env.ETHERSCAN_KEY,
        },
    },
};

module.exports = Object.assign(config._shared, config[env]);
