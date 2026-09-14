import {spawn} from 'node:child_process';
for(const key of ['APP_ORIGIN','ADMIN_USERNAME','ADMIN_PASSWORD_HASH','SESSION_SECRET','VAULT_KEY'])if(!process.env[key])throw Error(`Missing ${key}`);
await new Promise((resolve,reject)=>{const migrate=spawn(process.execPath,['scripts/migrate.mjs'],{stdio:'inherit'});migrate.on('error',reject);migrate.on('exit',code=>code===0?resolve():reject(Error(`Migration failed (${code})`)));});
const server=spawn(process.execPath,['server.js'],{stdio:'inherit'});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.kill(signal));
server.on('error',e=>{console.error(e.message);process.exitCode=1;});server.on('exit',code=>{process.exitCode=code??1;});
