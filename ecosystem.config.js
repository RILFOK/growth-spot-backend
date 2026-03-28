module.exports = {
  apps: [
    {
      name: 'project1-backend',
      script: './index.js',
      cwd: '/home/developer/project1/backend',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
}

