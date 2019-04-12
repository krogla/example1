const debug = require('debug')('tskmgr:bot_reply');
require('dotenv').config();
const Op = require('sequelize')['Op'];
const db = require('../models');
const redisClient = require('redis').createClient()
const ethers = require('ethers')
const {promisify} = require('util');
// const cacheSet = redisClient.set;
const cacheGet = promisify(redisClient.get).bind(redisClient);


const config = require('../config');
const provider = new ethers.providers.FallbackProvider([
    new ethers.providers.EtherscanProvider(config.app.eth.network, config.key.etherscan),
    new ethers.providers.InfuraProvider(config.app.eth.network, config.key.infura),
]);
const address = getContract('bets').address
const abi = getContract('bets').abi
const contract = new ethers.Contract(address, abi, provider)
const mnemonic = process.env.BOT_REPLY_MNEMONIC;
const walletIds = [0,1,2,3]
const wallets = walletIds.reduce((a,id) => { a[id] = {id:id, balance: ethers.constants.Zero, wallet: getWallet(id).connect(provider)}; return a; }, {})


const racePairs = [
    {ally: 1, enemy: 13},
    {ally: 1, enemy: 4},
    {ally: 1, enemy: 10},
    {ally: 13, enemy: 4},
    {ally: 13, enemy: 10},
    {ally: 4, enemy: 10}
]


const betLevels = [
    { level: 1, value: ethers.utils.parseEther('0.01') },
    { level: 2, value: ethers.utils.parseEther('0.05') },
    // { level: 3, value: ethers.utils.parseEther('0.1') },
    // { level: 4, value: ethers.utils.parseEther('0.5') },
    // { level: 5, value: ethers.utils.parseEther('1') },
    // { level: 6, value: ethers.utils.parseEther('5') },
    // { level: 7, value: ethers.utils.parseEther('10') }
]

const topUpSum = ethers.utils.parseEther('0.06')
const maxGasPrice = ethers.utils.parseUnits('8','gwei')

const gasLimitBet = 800000
const gasLimitReward = 250000
let curGasPrice = ethers.constants.WeiPerEther
let curBlock = 0


function getWallet(id) {
    return ethers.Wallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${id}`);
}
function getContract(contract) {
    return config.app.eth.contracts.find(c => c.name === contract)
}

async function processBets(bets) {
    let ally, enemy, level, betLevel
    for (let i = 0; i < bets.length; i++) {
        [ally, enemy, level] = bets[i]
        betLevel = betLevels.find(x => x.level === level)

        let gasCost = curGasPrice.mul(gasLimitBet).add(betLevel.value)
        // debug('gasCost', ethers.utils.formatUnits(gasCost, 'ether'))
        let availWalletIds = walletIds.filter(id => id !== 0) //skip main wallet
                                      .sort((aId, bId) => wallets[aId].balance.gt(wallets[bId].balance) ? -1 : //sort desc
                                          wallets[aId].balance.lt(wallets[bId].balance) ? 1 : 0);

        let walletIdsWithEnoughAmount = availWalletIds.filter(id => wallets[id].balance.gte(gasCost))
        if (walletIdsWithEnoughAmount.length) {
            let id = walletIdsWithEnoughAmount[0]
            try {
                let c = contract.connect(wallets[id].wallet)

                let gasEst = await c.estimate.makeBet(ally, enemy, 0, 2, {
                    value: betLevel.value,
                    gasLimit: gasLimitBet
                });
                if (gasEst.lte(gasLimitBet)) {

                    let txResp = await c.functions.makeBet(ally, enemy, 0, 2, {
                        value: betLevel.value,
                        gasPrice: curGasPrice,
                        gasLimit: gasLimitBet,
                        nonce: wallets[id].nonce
                    });

                    debug('bet tx sent', bets[i], txResp);

                    // provider.waitForTransaction(txResp.hash).then(console.log).catch(console.log)
                    wallets[id].balance = wallets[id].balance.sub(gasCost);
                    wallets[id].nonce++
                }
            } catch (e) {
                debug(e)
                // throw e
            }
        } else {
            debug('top up lowest wallet')
            debug(walletIdsWithEnoughAmount.map(id => ({id: id, b: ethers.utils.formatEther(wallets[id].balance)})) )
            let topUpCost = curGasPrice.mul(21000).add(topUpSum)
            if (wallets[0].balance.gte(topUpCost)) {
                let id = availWalletIds[0]
                try {
                    let txRest = await wallets[0].wallet.sendTransaction({
                        to: wallets[id].wallet.address,
                        value: topUpSum,
                        gasLimit: 21000,
                        gasPrice: curGasPrice,
                    })

                    debug('topup tx sent', txRest);
                } catch (e) {
                    debug('bet fail', e)
                    throw e
                }
            } else {
                debug('no money for topup', bets[i])
            }

        }
    }
}



async function processReward() {
    let gasCost = curGasPrice.mul(gasLimitReward)
    // debug('gasCost', ethers.utils.formatUnits(gasCost, 'ether'))

    let availWalletIds = walletIds.filter(id => wallets[id].balance.gte(gasCost))
    let id
    for(let i = 0; i < availWalletIds.length; i ++) {

        id = availWalletIds[i];
        if (id === 0) continue;
        // debug('wallet to check', id)
        let c = contract.connect(wallets[id].wallet)
        try {
            let winBets = await db.Bet.findAll({
                attributes: ['id','bettor_idx'],
                where: {
                    bettor: {[Op.like]: wallets[id].wallet.address},
                    winner: true,
                    closed: false,
                },
                include: [{
                    attributes: ['id'],
                    model: db.Round,
                    where: { finished: true }
                }]
            })
            // debug('bets reward for wallet ', id, winBets.map(b => b.id))
            for (let j = 0; j < winBets.length; j++) {
                //todo remember sent tx to avoid send again
                let gasEst
                try {
                    gasEst = await c.estimate.rewardMyBet(winBets[j].bettor_idx, {
                        gasLimit: gasLimitReward
                    });
                } catch (e) {
                    debug('reward fail, skip', wallets[id].wallet.address, winBets[j].bettor_idx, e)
                    continue
                    // throw e
                }
                if (gasEst.lte(gasLimitReward)) {
                    let txResp = await c.functions.rewardMyBet(winBets[j].bettor_idx, {
                        gasPrice: curGasPrice,
                        gasLimit: gasLimitReward,
                        nonce: wallets[id].nonce
                    });
                    wallets[id].nonce++
                    debug('reward tx sent', winBets[j].id, txResp);
                }

            }
        } catch (e) {
            debug('reward fail', e)
            throw e
        }

    }

}

// function getRandomInt(min, max) {
//     return Math.floor(Math.random() * (max - min)) + min;
// }

module.exports = function(taskMgr, queueName, cfg) {

    const start = async () => {
        //do init here
        // push repeated job
        await taskMgr.pushJob(queueName, {});
    };

    const job = job => {
        // Do some heavy work
        return Promise.all([provider.getGasPrice(), provider.getBlockNumber()])
                      .then(ethData => {
                          curGasPrice = ethData[0].mul(1037).div(1000)
                          if (curGasPrice.gte(maxGasPrice)) {
                              throw ('gasPrice to high: ' + ethers.utils.formatUnits(curGasPrice, 'gwei'))
                          }

                          curBlock = ethData[1]

                          return cacheGet("lastBlock");
                      })
                      .then(lastBlock => {
                          debug(curBlock, lastBlock)
                          if (lastBlock && lastBlock >= curBlock) throw 'no new blocks';
                          return Promise.all([
                              Promise.all(walletIds.map(id => wallets[id].wallet.getBalance())),
                              Promise.all(walletIds.map(id => wallets[id].wallet.getTransactionCount()))
                          ])
                      })
                      .then(data => {
                          walletIds.forEach((id, i) => {
                              wallets[id].balance = data[0][i]
                              wallets[id].nonce = data[1][i]
                          })
                          // debug('wallets', wallets)

                          let reqs = []
                          betLevels.forEach(l => {
                              //direct
                              reqs.push(Promise.all(racePairs.map(p => {
                                  // debug('check queue',p.ally, p.enemy, l.level)
                                  return contract.functions.getBetQueueLength(p.ally, p.enemy, l.level)
                              })))
                              //reverse
                              reqs.push(Promise.all(racePairs.map(p => {
                                  // debug('check queue',p.enemy, p.ally, l.level)
                                  return contract.functions.getBetQueueLength(p.enemy, p.ally, l.level)
                              })))
                          })
                          return Promise.all(reqs)
                      })
                      .then(data => {
                          let qLenD = [], qLenR = []
                          betLevels.forEach((bl, i) => {
                              qLenD.push(data[i * 2].map(l => l.toNumber()))
                              qLenR.push(data[i * 2 + 1].map(l => l.toNumber()))
                          })
                          let bets = []

                          betLevels.forEach((bl, k) => {
                              for (let i = 0; i < racePairs.length; i++) {
                                  if (qLenD[k][i] > 0) {
                                      bets.push([racePairs[i].enemy, racePairs[i].ally, bl.level]);
                                  } else if (qLenR[k][i] > 0) {
                                      bets.push([racePairs[i].ally, racePairs[i].enemy, bl.level]);
                                  }
                              }
                          })
                          //check bets
                          return processBets(bets).then(() => {
                              redisClient.set('lastBlock', curBlock);
                          })
                      })
                      .then(() => {
                          //check prize
                          return processReward()
                      })
    };

    return {job, start};
};

