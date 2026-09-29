import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {EYES,lookOf} from '../src/lib/pfp/render/look.ts'
import {TRAITS,DEFAULT_PFP} from '../src/lib/pfp/traits.ts'
import * as head from '../src/lib/pfp/render/head.ts'
function fingerprint(group){const h=createHash('sha256');group.updateMatrixWorld(true);group.traverse(o=>{if(o.geometry){h.update(Buffer.from(o.geometry.attributes.position.array.buffer));h.update(JSON.stringify(o.matrixWorld.elements));const m=o.material;h.update(JSON.stringify([m.color?.getHex(),m.emissive?.getHex()]))}});return h.digest('hex')}
test('every eye choice has its own 3D treatment',()=>{assert.equal(Object.keys(EYES).length,16);assert.equal(new Set(Object.values(EYES).map(x=>JSON.stringify(x))).size,16)})
test('all ten mouth meshes are distinct, finite, and stay on the lower face',()=>{assert.equal(typeof head.mouth,'function');const ids=['tongue','smile','grin','smirk','open','grimace','bubblegum','fangs','gold','drool'];const hashes=ids.map(id=>{const group=head.mouth(id);group.updateMatrixWorld(true);group.traverse(o=>{if(o.geometry)for(const v of o.geometry.attributes.position.array)assert.ok(Number.isFinite(v),id)});return fingerprint(group)});assert.equal(new Set(hashes).size,10)})

test('mouth geometry sits on the lower hemisphere rather than floating across the eyes',()=>{
  for(const id of ['tongue','smile','grin','smirk','open','grimace','bubblegum','fangs','gold','drool']){
    const group=head.mouth(id);group.updateMatrixWorld(true)
    group.traverse(o=>{if(!o.geometry)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){
      const point=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld)
      assert.ok(point.y<-.35,`${id} must stay below eye sockets`)
      assert.ok(point.length()>.96&&point.length()<1.45,`${id} must attach to the face`)
    }})
  }
})

import * as THREE from 'three'
import {disposeScene} from '../src/lib/pfp/render/scene.ts'
test('scene cleanup releases unique materials, geometry, textures and shadow targets exactly once',()=>{
  const scene=new THREE.Scene(),counts={geometry:0,material:0,texture:0,shadow:0,retained:0}
  const geometry=new THREE.SphereGeometry(),texture=new THREE.Texture(),material=new THREE.MeshStandardMaterial({map:texture})
  geometry.addEventListener('dispose',()=>counts.geometry++);texture.addEventListener('dispose',()=>counts.texture++);material.addEventListener('dispose',()=>counts.material++)
  scene.add(new THREE.Mesh(geometry,material),new THREE.Mesh(geometry,material))
  const cached=new THREE.Texture();cached.userData.keep=true;cached.addEventListener('dispose',()=>counts.retained++)
  const other=new THREE.MeshStandardMaterial({map:cached});scene.add(new THREE.Mesh(geometry,other))
  const light=new THREE.DirectionalLight();light.shadow.dispose=()=>counts.shadow++;scene.add(light)
  disposeScene(scene);assert.deepEqual(counts,{geometry:1,material:1,texture:1,shadow:1,retained:0})
})

test('each sculpted expression builds different finite geometry, including asymmetric wink and lids',()=>{
  const ids=['wink','sleepy','wide','happy','angry','cross','money','spiral']
  const signatures=ids.map(id=>{
    const eyeGroup=head.eyes(EYES[id],[],{body:'#b8e65c',crater:'#86b52c'})
    eyeGroup.traverse(o=>{if(o.geometry)for(const v of o.geometry.attributes.position.array)assert.ok(Number.isFinite(v),id)})
    return fingerprint(eyeGroup)
  })
  assert.equal(new Set(signatures).size,ids.length)
})
