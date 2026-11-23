# Splice new animations from new_anims.glb into the ORIGINAL Sin glb (mesh/materials/skin untouched).
import json,struct,sys,math
import numpy as np
def load(p):
    d=open(p,'rb').read(); L=struct.unpack('<I',d[12:16])[0]; j=json.loads(d[20:20+L])
    o=20+L; bl=struct.unpack('<I',d[o:o+4])[0]; return j,bytearray(d[o+8:o+8+bl])
O,OB=load(sys.argv[1]); N,NB=load(sys.argv[2]); out=sys.argv[3]
oidx={n['name']:i for i,n in enumerate(O['nodes'])}
CT={5126:'f4'}; NC={'SCALAR':1,'VEC3':3,'VEC4':4}
def acc(j,b,i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]; off=bv.get('byteOffset',0)+a.get('byteOffset',0)
    return np.frombuffer(bytes(b[off:off+a['count']*NC[a['type']]*4]),dtype='<f4').reshape(a['count'],NC[a['type']]).copy()
# rest check
bad=0
for n in N['nodes']:
    if n['name'] in oidx and 'mesh' not in n and n['name']!='Armature':
        o=O['nodes'][oidx[n['name']]]
        for k,dflt in (('translation',[0,0,0]),('rotation',[0,0,0,1])):
            a=np.array(n.get(k,dflt)); b=np.array(o.get(k,dflt))
            if k=='rotation' and np.dot(a,b)<0: b=-b
            if np.abs(a-b).max()>2e-4: bad+=1; print('REST MISMATCH',n['name'],k,a,b)
print('rest mismatches',bad)
# rename old same-named clips
NEWN=[a['name'] for a in N['animations']]
for a in O['animations']:
    if a['name'] in NEWN: a['name']+='_legacy'
def add(arr,typ,minmax=False):
    global OB
    while len(OB)%4: OB.append(0)
    off=len(OB); data=arr.astype('<f4').tobytes(); OB+=data
    O['bufferViews'].append({'buffer':0,'byteOffset':off,'byteLength':len(data)})
    a={'bufferView':len(O['bufferViews'])-1,'componentType':5126,'count':int(arr.shape[0]),'type':typ}
    if minmax: a['min']=[float(x) for x in arr.min(0)]; a['max']=[float(x) for x in arr.max(0)]
    O['accessors'].append(a); return len(O['accessors'])-1
stats={}
for an in N['animations']:
    ch=[];sm=[];tcache={}
    for c in an['channels']:
        s=an['samplers'][c['sampler']]; node=N['nodes'][c['target']['node']]['name']; path=c['target']['path']
        if node not in oidx: continue
        if path=='scale': continue
        v=acc(N,NB,s['output'])
        rest=np.array(O['nodes'][oidx[node]].get('translation' if path=='translation' else 'rotation',[0,0,0] if path=='translation' else [0,0,0,1]))
        if path=='translation' and np.abs(v-rest).max()<1e-5: continue
        if path=='rotation':
            for i in range(1,len(v)):
                if np.dot(v[i],v[i-1])<0: v[i]=-v[i]
            if np.abs(v-rest).max()<1e-6 or np.abs(v+rest).max()<1e-6: continue
        if s['input'] not in tcache: tcache[s['input']]=add(acc(N,NB,s['input']),'SCALAR',True)
        sm.append({'input':tcache[s['input']],'output':add(v,'VEC3' if path=='translation' else 'VEC4'),'interpolation':'LINEAR'})
        ch.append({'sampler':len(sm)-1,'target':{'node':oidx[node],'path':path}})
    O['animations'].append({'name':an['name'],'channels':ch,'samplers':sm})
    stats[an['name']]=(len(ch),float(acc(N,NB,an['samplers'][0]['input'])[-1][0]))
print('added',stats)
while len(OB)%4: OB.append(0)
O['buffers'][0]['byteLength']=len(OB)
ex=O['scenes'][0].setdefault('extras',{})
old=ex.pop('combat',None)
if old: ex['combat_legacy']={k+('_legacy' if k in NEWN else ''):v for k,v in old.items()}
ex['combat']=json.loads(open(sys.argv[4]).read())
O['asset']['generator']=O['asset'].get('generator','')+' + retargeted combat set v2 (Axe_CombatIdle, Attack_Right, Attack_Left, Finisher_Heavy, Finisher_Jump)'
js=json.dumps(O,separators=(',',':')).encode()
while len(js)%4: js+=b' '
tot=12+8+len(js)+8+len(OB)
with open(out,'wb') as f:
    f.write(struct.pack('<III',0x46546C67,2,tot)); f.write(struct.pack('<II',len(js),0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II',len(OB),0x004E4942)); f.write(OB)
print('wrote',out,tot)
