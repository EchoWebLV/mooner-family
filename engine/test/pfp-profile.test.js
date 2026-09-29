import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { Store } from '../server/store.js';
import { loginMessage, makeSocialRoutes } from '../server/social.js';

const legacy = {skin:'moon',eyes:'star',head:'none',face:'none',outfit:'none',neck:'none',aura:'none',bg:'midnight'};
test('profiles accept legacy clients and persist an optional validated mouth', async t => {
  const store = new Store(':memory:');
  t.after(() => store.db.close());
  const routes = makeSocialRoutes({store,isPresale:()=>false});
  const route = (method,path) => routes.find(r=>r.method===method && r.path.test(path)).handler;
  const kp = Keypair.generate(), wallet = kp.publicKey.toBase58(), time = Math.floor(Date.now()/1000);
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(kp.secretKey.subarray(0,32))]);
  const signature = crypto.sign(null, Buffer.from(loginMessage(wallet,time)), crypto.createPrivateKey({key:der,format:'der',type:'pkcs8'})).toString('base64');
  const {json:{token}} = await route('POST','/api/login')({body:{wallet,time,signature},ip:'test'});
  const save = pfp => route('POST','/api/profile')({body:{token,pfp}});
  const get = async () => (await route('GET','/api/profiles')()).json.profiles[wallet];
  assert.deepEqual((await save(legacy)).json.pfp,legacy);
  assert.deepEqual(await get(),legacy);
  const modern = {...legacy,mouth:'bubblegum'};
  assert.deepEqual((await save(modern)).json.pfp,modern);
  assert.deepEqual(await get(),modern);
  for (const mouth of ['',null,22,'BAD','bad mouth','a'.repeat(33)]) {
    await assert.rejects(save({...legacy,mouth}), /pfp.mouth must be a trait id/);
    assert.deepEqual(await get(),modern,'invalid update must preserve saved profile');
  }
});
