import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { publicAddress, publicUrl, fetchPublic, readPage, webSearch } from '../server/browse.mjs';

test('rejects non-public IPs, local names, credentials, odd ports, and encoded loopback',()=>{
  for(const address of ['0.0.0.0','127.0.0.1','10.1.2.3','100.64.0.1','169.254.169.254','172.16.1.1','192.168.1.1','198.18.0.1','224.0.0.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::']) assert.equal(publicAddress(address),false,address);
  for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) assert.equal(publicAddress(address),true,address);
  for(const url of ['file:///etc/passwd','http://localhost','http://printer.local','http://metadata.internal','http://2130706433','http://0x7f000001','http://[::ffff:127.0.0.1]','http://user:pass@example.com','https://example.com:8080']) assert.throws(()=>publicUrl(url),undefined,url);
});

test('MCP stdio exposes web tools and bounded persistent pet memory',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'pet-tools-'));
  const transport=new StdioClientTransport({command:process.execPath,args:['server/pet-tools.mjs'],env:{...process.env,PETSHOP_PET_MEMORY:path.join(tmp,'notes.md')},stderr:'pipe'});
  const client=new Client({name:'petshop-test',version:'1'});
  try {
    await client.connect(transport);
    const list=await client.listTools();
    assert.deepEqual(list.tools.map(t=>t.name).sort(),['read_memory','read_page','web_search','write_memory']);
    const call=async(name,args={})=>client.callTool({name,arguments:args});
    assert.equal(JSON.parse((await call('read_memory')).content[0].text).notes,'');
    assert.equal(JSON.parse((await call('write_memory',{notes:'JP is cycling in France.'})).content[0].text).saved,true);
    assert.equal(JSON.parse((await call('read_memory')).content[0].text).notes,'JP is cycling in France.');
    assert.equal((await call('read_page',{url:'http://127.0.0.1'})).isError,true);
    assert.equal((await call('write_memory',{notes:'x'.repeat(12001)})).isError,true);
  } finally {await client.close();await fs.rm(tmp,{recursive:true,force:true});}
});

// Explicit live gate so routine tests do not depend on external network services.
if(process.env.PETSHOP_WEB_SMOKE==='1') {
  test('live public search, reading, DNS and redirect destination blocks',async()=>{
    const search=await webSearch('Provence cycling tourism');
    assert.ok(search.results.length>0);
    assert.ok(['Bing public RSS search','DuckDuckGo public HTML'].includes(search.provider));
    const news=await webSearch('recent AI news');
    assert.equal(news.provider,'Bing public news RSS');
    assert.equal(news.searchQuery,'artificial intelligence');
    assert.ok(news.results.some(r=>r.publishedAt));
    const page=await readPage('https://example.com');
    assert.match(page.text,/Example Domain/);
    assert.ok(page.text.length<=12000);
    assert.ok(page.links.some(link=>link.url.includes('iana.org')));
    assert.ok(page.links.length<=40);
    await assert.rejects(fetchPublic('https://localtest.me'),/private|reserved/);
    await assert.rejects(fetchPublic('https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1'),/private|reserved/);
  });
}
