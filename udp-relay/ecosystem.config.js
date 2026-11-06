// pm2 config for the UDP voice relay.
//
// Launch:   pm2 start ecosystem.config.js
// Status:   pm2 info nexus-udp-relay
// Dump rooms (prints the current membership table to the log):
//           pm2 sendSignal SIGUSR2 nexus-udp-relay

module.exports = {
  apps: [
    {
      name: 'nexus-udp-relay',
      script: 'server.js',
      cwd: __dirname,
      env: {
        UDP_PORT: 41234,
        UDP_HOST: '0.0.0.0',
      },
      // UDP is single-process by design — forking would split the room
      // state across workers. One instance, autorestart on crash.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '256M',
    },
  ],
};
