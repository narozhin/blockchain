const ifaces = require('os').networkInterfaces();
const defConfig = require('./config')

const getCurrentIP = () => {
    const result = []
    Object.keys(ifaces).forEach((ifname) => {
        ifaces[ifname].forEach((iface) => {
            if(iface.family !== 'IPv4' || iface.internal !== false) return
            result.push(iface.address)
        })
    })
    return result
}

module.exports = {
    printWelcome : () => {
      console.log('')
      console.log('#################################')
      console.log('# SIMPLE BLOCKCHAIN REALISATION #')
      console.log('#################################')
      console.log('')
    },
    printLinks: (port) => getCurrentIP().forEach((ip) => {
      console.log('http://' + ip + ':' + port)
      console.log('ws://' + ip + ':' + port)
      console.log('')
    }),
    getConfig: () => {
        const result = JSON.parse(JSON.stringify(defConfig))
        process.argv.slice(2).forEach((argument) => {
            const buff = argument.split('=')
            if(buff.length !== 2) return
            const name = buff[0].trim()
            let value = buff[1].trim()
            if(name === 'peers') value = value.split(',').map((address) => 'ws://' + address)
            result[name] = value
        })
        return result
    }
}
