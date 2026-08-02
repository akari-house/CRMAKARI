import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root=join(process.cwd(),'public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};

createServer(async(request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');
  let pathname=decodeURIComponent(url.pathname);
  if(pathname==='/')pathname='/index.html';
  else if(pathname==='/app'||pathname==='/app/'||pathname.startsWith('/app/'))pathname='/app/index.html';
  const relative=normalize(pathname).replace(/^([/\\])+/, '');
  if(relative.startsWith('..')){response.writeHead(403);response.end('Forbidden');return;}
  try{
    const body=await readFile(join(root,relative));
    response.writeHead(200,{'content-type':types[extname(relative)]||'application/octet-stream','cache-control':'no-store'});
    response.end(body);
  }catch{response.writeHead(404,{'content-type':'text/plain; charset=utf-8'});response.end('Not found');}
}).listen(4173,'127.0.0.1');
