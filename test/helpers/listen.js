// WHATWG fetch запрещает несколько портов, которые ОС может выбрать для listen(0).
export async function listen(app){
 for(;;){
  const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  if(![6000,6665,6666,6667,6668,6669,6697,10080].includes(server.address().port))return server;
  await new Promise(resolve=>server.close(resolve));
 }
}
