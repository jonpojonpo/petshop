export async function api(url: string, body?: unknown) {
  let r: Response;
  try { r=await fetch(url, body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }
  catch { throw new Error('Your pet lost its connection. Your conversation is saved; try again in a moment.'); }
  if (!(r.headers.get('content-type') || '').includes('application/json')) {
    if(r.status===401||r.status===403)throw new Error('Please reopen Petshop and sign in again. Your conversations are saved.');
    throw new Error('Your home Petshop is reconnecting. Your conversation is saved; try again in a moment.');
  }
  const d=await r.json();
  if(!r.ok)throw new Error(d.error || 'Your pet could not finish that request.');
  return d;
}
