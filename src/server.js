const net=require('net');
const PORT=4000;
const IDLE_TIMEOUT=60000;
const server=net.createServer();
const clients=new Map();
const usernames=new Set(); 
const messageHistory=[]; 

function resetIdleTimeout(username){
  // console.log(username)
  if(clients.has(username)){
    const client=clients.get(username);
    clearTimeout(client.timeout);
    client.timeout=setTimeout(()=>{
      disconnectUser(username,'idle timeout');
    },IDLE_TIMEOUT);
  }
}

function disconnectUser(username,reason='disconnected') {
  if(!clients.has(username))return;
  const {socket}=clients.get(username);
  usernames.delete(username);
  clients.delete(username);
  clearTimeout(socket.userTimeout);
  const infoMsg=`INFO ${username} ${reason}\n`;
  for(const[,client] of clients){
    client.socket.write(infoMsg);
  }
  socket.end();
  console.log(`${username} disconnected (${reason})`);
}

server.on('connection',(socket)=>{
  console.log('Client connected');
  socket.setEncoding('utf8');
  let buffer='';
  let username=null;
  const initialTimeout=setTimeout(()=>{
    if(!username)socket.end();
  },IDLE_TIMEOUT);
  socket.userTimeout=initialTimeout;

  socket.on('data',(data)=>{
    buffer+=data;
    const lines=buffer.split('\n');
    buffer=lines.pop() || ''; 

    for(const line of lines){
      const trimmedLine=line.trim();
      if(!trimmedLine)continue;
      clearTimeout(socket.userTimeout);
      socket.userTimeout=setTimeout(()=>{
        if(username)disconnectUser(username,'idle timeout');
      },IDLE_TIMEOUT);
      if(!username){
        if(trimmedLine.startsWith('LOGIN ')){
          username=trimmedLine.slice(6).trim();
          if(usernames.has(username)){
            socket.write('ERR username-taken\n');
            username=null; 
          }else{
            usernames.add(username);
            clients.set(username,{socket,timeout:null});
            socket.username=username; 
            socket.write('OK\n');
            for(const msg of messageHistory.slice(-100)){
              socket.write(`MSG ${msg.user} ${msg.text}\n`);
            }
            resetIdleTimeout(username);
            clearTimeout(initialTimeout);
            console.log(`${username} logged in`);
          }
        }else{
          socket.write('Please login first with LOGIN <username>\n');
        }
      }else{
        if(trimmedLine==='WHO'){
          for(const u of usernames){
            socket.write(`USER ${u}\n`);
          }
          resetIdleTimeout(username);
        }else if(trimmedLine==='PING'){
          socket.write('PONG\n');
          resetIdleTimeout(username);
        }else if(trimmedLine.startsWith('DM ')){
          const parts=trimmedLine.slice(3).trim().split(' ', 2);
          if(parts.length<2) {
            socket.write('ERR invalid-dm-format\n');
            continue;
          }
          const target=parts[0].trim();
          let text=parts[1].trim();
          text=text.replace(/\s+/g,' ').trim();
          if(!text) continue;
          if(target===username){
            socket.write('ERR cannot-dm-self\n');
            continue;
          }
          if(usernames.has(target)){
            const dmMsg=`DM ${username} ${text}\n`;
            clients.get(target).socket.write(dmMsg);
            socket.write(`DM ${target} ${text}\n`); 
          }else{
            socket.write('ERR user-not-found\n');
          }
          resetIdleTimeout(username);
        }else if(trimmedLine.startsWith('MSG ')){
          let text=trimmedLine.slice(4).trim();
          text=text.replace(/\s+/g, ' ').trim();
          if(!text)continue;
          const msg={ user: username,text };
          messageHistory.push(msg);
          if(messageHistory.length>100)messageHistory.shift(); 
          const broadcastMsg=`MSG ${msg.user} ${msg.text}\n`;
          for(const [, client] of clients){
            client.socket.write(broadcastMsg);
          }
          resetIdleTimeout(username);
        }else{
          console.log(`Unknown command from ${username}: ${trimmedLine}`);
        }
      }
    }
  });
  socket.on('end',()=>{
    if(username){
      disconnectUser(username);
    }else{
      clearTimeout(initialTimeout);
    }
    console.log('Client disconnected');
  });
  socket.on('error',(err)=>{
    console.log('Socket error:',err.message);
    if(username)disconnectUser(username,'error');
    else socket.end();
  });
});
server.on('error',(err)=>{
  console.error('Server error:',err.message);
});
server.listen(PORT,'localhost',()=>{
  console.log(`Chat server listening on localhost:${PORT}`);
});
process.on('SIGINT',()=>{
  console.log('\nShutting down server...');
  server.close(()=>{
    process.exit(0);
  });
});