// pm2 process definition. Optional: `npm start` works without pm2.
//   pm2 start ecosystem.config.js
//   pm2 logs slack-claude-agent
//   pm2 restart slack-claude-agent   (needed to pick up prompt.md edits)
module.exports = {
  apps: [
    {
      name: 'slack-claude-agent',
      script: 'server.js',
      env: {},
    },
  ],
};
