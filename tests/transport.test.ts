import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {localTransport} from '../server/local-transport.ts';
test('local transport translates MCP namespaces in both directions, preserving split UTF-8 SSE',async()=>{
 let seen:any;
 const upstream=http.createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);seen=JSON.parse(Buffer.concat(chunks).toString());
  res.setHeader('content-type','text/event-stream');
  const call={type:'function_call',name:'mcp__petshop_browser__read_page',arguments:'{"url":"https://example.com"}'};
  const stream=Buffer.from('data: '+JSON.stringify({type:'response.output_item.added',item:call})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{output:[call,{type:'message',text:'café 🐕'}]}})+'\n\ndata: [DONE]\n\n');
  for(const byte of stream)res.write(Buffer.from([byte]));res.end();
 });
 await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));
 const port=(upstream.address() as any).port;const transport=await localTransport(`http://127.0.0.1:${port}`);
 try {
  const response=await fetch(transport.url+'/responses',{method:'POST',body:JSON.stringify({input:[{type:'function_call',namespace:'mcp__petshop_browser',name:'read_page',arguments:'{}'}],tools:[{type:'namespace',name:'mcp__petshop_browser',tools:[{type:'function',name:'read_page',parameters:{}}]}]})});
  const text=await response.text();const events=text.split('\n').filter(l=>l.startsWith('data: {')).map(l=>JSON.parse(l.slice(6)));
  assert.equal(seen.tools[0].name,'mcp__petshop_browser__read_page');assert.equal(seen.input[0].name,seen.tools[0].name);assert.equal(seen.input[0].namespace,undefined);
  assert.equal(events[0].item.name,'read_page');assert.equal(events[0].item.namespace,'mcp__petshop_browser');assert.equal(events[1].response.output[0].namespace,'mcp__petshop_browser');assert.equal(events[1].response.output[1].text,'café 🐕');
 } finally {transport.close();upstream.closeAllConnections();await new Promise<void>(r=>upstream.close(()=>r()));}
});
