
const CryptoJS = require('crypto-js')
const express = require('express')
const bodyParser = require('body-parser')

const logger = require('./logger')
const utils = require('./utils')

var app = require('express')()
var server = require('http').createServer(app)
var io = require('socket.io')(server)
var connectToServer = require('socket.io-client')

// Цепочка блоков
let blockchain = []

// Класс блока
class Block {
    constructor(index, prevHash, data, timestamp, hash) {
        this.index = index // Индекс блока в цепочке
        this.prevHash = prevHash // Hash предыдущего блока
        this.timestamp = timestamp ? timestamp : +new Date() // Время создания блока
        this.data = data // Данные блока
        this.hash = hash ? hash : getBlockHash(this.index, this.prevHash, this.timestamp, this.data) // Hash текущего блока
    }
}

// Получить последний блок в цепочке
const getLastBlock = () => blockchain[blockchain.length - 1]
// Получить идентификатор последнего блока
const getLastIndex = () => getLastBlock().index
// Получить Генезис блок
const getGenesisBlock = () => blockchain[0]
// Создать следующий блок
const createNextBlock = (data) => new Block(getLastIndex() + 1, getLastBlock().hash, data)
// Создать первый блок в цепочке
const createGenesisBlock = () => new Block(0, '0', 'first block', 1489649239990, '32f0256825c4258ac35ef7e1073506e2494359caf3fc55907b41adbc59436f13')
// Получить hash блока
const getBlockHash = (index, prevHash, timestamp, data) => CryptoJS.SHA256(index + prevHash + timestamp + data).toString()
// Расчет hash блока
const calculateBlockHash = (block) => getBlockHash(block.index, block.prevHash, block.timestamp, block.data)
// Проверка валидности блока
const isValidBlock = (block) => (getLastBlock().hash === block.prevHash) && (calculateBlockHash(block) === block.hash)
// Проверка корректности hash блока
const isCorrectBlockHash = (block) => calculateBlockHash(block) === block.hash
// Проверка правильной "связанности" блоков
const isConnectedBlocks = (firstBlock, secondBlock) =>  (firstBlock.hash === secondBlock.prevHash && firstBlock.index === secondBlock.index - 1 && isCorrectBlockHash(firstBlock) && isCorrectBlockHash(secondBlock))
// Проверка идентичности блоков
const isEqualsBlocks = (firstBlock, secondBlock) => JSON.stringify(firstBlock) === JSON.stringify(secondBlock)
// Добавить блок в цепочку
const addBlock = (block) => isValidBlock(block) ? blockchain.push(block) : null
// Проверка валидности цепочки
const isValidChain = (chain) => {
    if(chain.length <= blockchain.length) return false // Новая цепочка короче текущей - ошибка
    if(!isEqualsBlocks(chain[0], getGenesisBlock())) return false // Первые блоки в цепочках не совпадают - ошибка
    if(chain.length === 1) return true // Длинна цепочки - 1 блок и он совпадает с Генезис блоком текущей цепочки - цепочка валидна
    for(let i = 1; i < chain.length; i++) {
      const firstBlock = chain[i - 1]
      const secondBlock = chain[i]
      if(!isConnectedBlocks(firstBlock, secondBlock)) return false // Не корректная связь между предыдущим и текущим блоком цепочки
    }
    return true
}
// Заменить текущую цепочку на более длинную
const replaceChain = (newChain) => isValidChain(newChain) ? blockchain = newChain : null
// Добавить Генезиз блок в цепочку
blockchain.push(createGenesisBlock())

//####################################//
//##            MESSAGES           ##//
//###################################//

// Зарегистрированные типы сообщений
const MessagesTypes = {
    GET_LATEST: 1,
    GET_ALL: 2,
    SET_BLOCKCHAIN: 3
}
// Генераторы сообщений
const msgGetLatest = () => ({type: MessagesTypes.GET_LATEST}) // Запросить последний блок в цепочке
const msgGetChain = () => ({type: MessagesTypes.GET_ALL}) // Запросить всю цепочку
const msgResponseChain = () => ({  // Отправить цепочку
  type: MessagesTypes.SET_BLOCKCHAIN,
  data: JSON.stringify(blockchain)
})
const msgReponseLatest = () => ({ // Отправить последний блок цепочки
  type: MessagesTypes.SET_BLOCKCHAIN,
  data: JSON.stringify([getLastBlock()])
})


//####################################//
//##           P2P SERVER          ##//
//###################################//

// Список активных подключений - пиров
const sockets = []

// Отправить сообщение пиру - участнику сети
const sendP2PMessage = (socket, message) => socket.send(JSON.stringify(message))
// "Широковещательное" сообщение
const broadcast = (message) => sockets.forEach((socket) => sendP2PMessage(socket, message))
// Удалить пир из списка активных пиров
const closeP2PConnection = (socket) => {
  logger.error('Failed connection to peer ' + socket.id)
  sockets.splice(sockets.indexOf(socket), 1)
}
// Обработка новой полученной цепочки
const onNewBlockchain = (chain) => {
  logger.info('Recive new blockchain')
  const recivedChain = chain.sort((firstBlock, secondBlock) => (firstBlock.index > secondBlock.index))
  const lastRecivedBlock = recivedChain[recivedChain.length - 1]
  const lastBlock = getLastBlock()
  if(lastBlock.index > lastRecivedBlock) return logger.error('Recived blockchain is not longer than current blockchain')
  if(lastBlock.hash === lastRecivedBlock.prevHash) { // Последний блок в полученной цепочке следует за последним блоком в текущей цепочке
      logger.info('Append recived block to chain')
      blockchain.push(lastRecivedBlock)
      broadcast(msgReponseLatest()) // Разослать полученный блок всем пирам
  } else if (recivedChain.length === 1) { // Длинна полученной цепочки - один блок
      logger.info('Query chain from our peer')
      broadcast(msgGetChain()) // Запрос цепочек у всех участников
  } else { // Заменить текущую цепочку на полученную, так как она длиннее
      logger.info('Recived blockchain is longer than current blockchain')
      replaceChain(recivedChain)
  }
}
// Обработка полученых сообщений сети P2P
const attachP2PMessageHandler = (socket) => {
  socket.on('message', (data) => {
      const message = JSON.parse(data)
      switch (message.type) {
        case MessagesTypes.GET_LATEST: // Запрос последнего блока
          sendP2PMessage(socket, msgReponseLatest()) // Отправить последний блок
          break;
        case MessagesTypes.GET_ALL: // Запрос всей цепочки
          sendP2PMessage(socket, msgResponseChain()) // Отправить всю цепочку
          break;
        case MessagesTypes.SET_BLOCKCHAIN: // Новая цепочка
          onNewBlockchain(JSON.parse(message.data)) // Обработка новой цепочки
          break;
      }
  })
}
// Обработка разрыва соединения с пиром
const attachP2PErrorHandler = (socket) => {
  socket.on('disconnect', () => closeP2PConnection(socket))
}
// Инициализация нового соединения с пиром
const initP2PConnection = (socket) => {
    sockets.push(socket)
    attachP2PMessageHandler(socket)
    attachP2PErrorHandler(socket)
    logger.info('New P2P connection')
}
// Подключение к новому пиру
const connectToPeer = (address) => {
    const socket = connectToServer(address)
    socket.on('connect', () => initP2PConnection(socket))
    socket.on('disconnect', () => logger.error('Failed connection to peer: ' + address))
}
// Подключиться к пулу пиров
const connectToPeers = (peers) => peers.forEach((address) => connectToPeer(address))

//####################################//
//##          HTTP SERVER          ##//
//###################################//

// Старт HTTP API сервера
const initHTTPServer = (port, next) => {
    app.use(bodyParser.json())
    // Возвращает текущую цепочку блоков
    app.get('/chain', (req, res) => res.send(JSON.stringify(blockchain)))
    // Добавить блок в цепочку и оповестить об этом участников сети
    app.get('/addblock', (req, res) => {
      const block = createNextBlock(req.query.data)
      addBlock(block)
      logger.info('Added new block: ' + block.hash)
      broadcast(msgReponseLatest())
      res.send()
    })
    // Возвращает список подключенных пиров
    app.get('/peers', (req, res) => res.send(JSON.stringify(sockets.map((peer) => peer._socket.remoteAddress + ':' + peer._socket.remotePort))))
    // Подключиться к пиру
    app.get('/addpeer', (req, res) => {
      connectToPeer(req.body.peer)
      res.send()
    })
    io.on('connection', (socket) => initP2PConnection(socket))
    server.listen(port, () => {
        logger.info('Start server in port ' + port)
        next()
    })
}

const main = () => {
  const config = utils.getConfig()
  utils.printWelcome()
  utils.printLinks(config.port)
  initHTTPServer(config.port, () => connectToPeers(config.peers))
}

main()
