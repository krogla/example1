const debug = require('debug')('tskmgr:cmc_grabber');

const Op = require('sequelize')['Op'];
const db = require('../models');
const axios = require('axios');
const redis = require('redis').createClient()


const config = require('../config')['app'];

module.exports = function(taskMgr, queueName, cfg) {

    const start = async () => {
        //do init here
        // push repeated job
        await taskMgr.pushJob(queueName, {});
    };

    const job = job => {
        // Do some heavy work
        let where = {active: true};
        return db.Race.findAll({where})
                 .then( races => Promise.all(races.map(r => axios.get(`https://widgets.coinmarketcap.com/v2/ticker/${r.cmc_coin_id}/?ref=widget`)
                                                            .then(({data}) => data.data))) )
                 .then(rates => {
                     let ticker = Date.now() / 1000 | 0;
                     debug('save rates', ticker);
                     return Promise.all(rates.map(r => db.CMCRate.findOrCreate({
                             where: {coin_id: r.id, last_updated: r.last_updated, price_USD: r.quotes.USD.price},
                             defaults: {
                                 ticker: ticker,
                                 // price_USD: r.quotes.USD.price,
                                 price_BTC: r.quotes.BTC.price,
                                 market_cap: r.quotes.USD.market_cap,
                             }
                         })
                     )).then(results => {
                         redis.publish(config.echo.ticker.channel,
                             JSON.stringify({
                                 "event": "App\\Events\\"+config.echo.ticker.events.rateTicker,
                                 "data": {
                                     ticker: ticker,
                                     rates: rates.map(r => ({
                                         id: r.id,
                                         symbol: r.symbol,
                                         price: r.quotes.USD.price,
                                         last_updated: r.last_updated,
                                     }))
                                 }
                             }));
                     })
                 })
    };

    return {job, start};
};

