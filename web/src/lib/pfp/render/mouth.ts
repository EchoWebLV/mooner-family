// Small sculpted expressions share one anatomical frame on the lower hemisphere.
import * as THREE from 'three'
import {dir,frame,quatOf,extrude,plastic,V} from './kit'
const F=frame(dir(12,-32))
/** Bend every vertex to the moon, so corners cannot hover or sink through its cheeks. */
function conform(geo:THREE.BufferGeometry,lift=0.01) {
  const p=geo.attributes.position
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i);p.setZ(i,p.getZ(i)+Math.sqrt(Math.max(0.01,1-x*x-y*y))-1+lift)}
  geo.computeVertexNormals();return geo
}
function path(points:number[][],radius:number,mat:THREE.Material) {
  const curve=new THREE.CatmullRomCurve3(points.map(([x,y,z=0])=>V(x,y,Math.sqrt(Math.max(0.01,1-x*x-y*y))-1+z)))
  return new THREE.Mesh(new THREE.TubeGeometry(curve,48,radius,12,false),mat)
}
export function mouth(id:string):THREE.Group {
  const g=new THREE.Group();g.name=`mouth:${id}`
  g.quaternion.copy(quatOf(F));g.position.copy(F.e)
  const dark=plastic('#200e23',0.36)
  const pink=()=>plastic('#ef628e',0.22)
  const aperture=(s:THREE.Shape)=>g.add(new THREE.Mesh(conform(extrude(s,0.007,0.006)),dark))
  const smile=(width:number,depth:number)=>{const s=new THREE.Shape();s.moveTo(-width,0.03);s.quadraticCurveTo(0,-0.02,width,0.055);s.quadraticCurveTo(width*.8,-depth,0,-depth);s.quadraticCurveTo(-width*.8,-depth,-width,.03);return s}
  if(id==='smile'||id==='smirk'){
    const pts=id==='smile'?[[-.26,.04],[-.13,-.06],[.04,-.075],[.25,.06]]:[[-.18,-.02],[0,-.05],[.18,.01],[.27,.11]]
    g.add(path(pts,.018,dark));return g
  }
  if(id==='open'){
    const s=new THREE.Shape();s.absellipse(0,-.035,.105,.15,0,Math.PI*2,false,0);aperture(s)
    const tongue=new THREE.Mesh(new THREE.SphereGeometry(1,32,20),pink());tongue.scale.set(.073,.043,.028);tongue.position.set(0,-.13,.023);g.add(tongue);return g
  }
  if(id==='bubblegum'){
    aperture(smile(.19,.08));const gum=new THREE.Mesh(new THREE.SphereGeometry(.195,64,48),new THREE.MeshPhysicalMaterial({color:'#ff72b2',roughness:.18,clearcoat:1,clearcoatRoughness:.06,transmission:.12,thickness:.3,ior:1.35}));gum.position.set(.1,-.07,.165);g.add(gum);return g
  }
  if(id==='grimace'){
    const s=new THREE.Shape();s.moveTo(-.29,.035);s.quadraticCurveTo(0,.09,.29,.035);s.lineTo(.27,-.1);s.quadraticCurveTo(0,-.13,-.27,-.1);s.closePath();aperture(s)
  }else aperture(smile(id==='grin'||id==='gold'?.34:.29,id==='grin'||id==='gold'?.19:.16))
  const white=plastic('#fff8e8',0.25)
  const toothMat=id==='gold'?new THREE.MeshPhysicalMaterial({color:'#eec45c',metalness:1,roughness:.2,clearcoat:.7}):white
  const count=id==='grin'||id==='gold'||id==='grimace'?7:2
  for(let i=0;i<count;i++){
    const x=count===2?(i? .2:-.2):(i-3)*.081
    const s=new THREE.Shape();const w=count===2?.063:.073,h=count===2?.065:id==='grimace'?.11:.12
    s.moveTo(x-w/2,.015);s.lineTo(x+w/2,.015);s.lineTo(x+w*.42,-h);s.quadraticCurveTo(x,-h-.014,x-w*.42,-h);s.closePath()
    const tooth=new THREE.Mesh(conform(extrude(s,.008,.005),.025),toothMat);g.add(tooth)
  }
  if(['tongue','fangs','drool'].includes(id)){
    if(id==='fangs')for(const x of [-.14,.14]){
      const s=new THREE.Shape();s.moveTo(x-.045,0);s.lineTo(x+.045,0);s.lineTo(x,-.16);s.closePath();g.add(new THREE.Mesh(conform(extrude(s,.012,.006),.035),white))
    }
    if(id==='drool'){
      const slime=plastic('#8cdd6a',.12)
      g.add(path([[.17,-.09,.028],[.19,-.2,.04],[.18,-.29,.03]],.025,slime))
      const drop=new THREE.Mesh(new THREE.SphereGeometry(.035,24,18),slime);drop.position.set(.18,-.3,-.012);drop.scale.y=1.35;g.add(drop)
    }else{
      const tongue=new THREE.Mesh(new THREE.SphereGeometry(1,48,32),pink());tongue.scale.set(.102,.14,.048);tongue.position.set(.025,-.145,.035);tongue.rotation.z=-.16;g.add(tongue)
      g.add(path([[.017,-.1,.081],[.025,-.17,.074],[.031,-.205,.063]],.005,plastic('#c43e69',.35)))
    }
  }
  return g
}
