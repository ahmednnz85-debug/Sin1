import bpy,sys,math
a=sys.argv[sys.argv.index('--')+1:]
if a[0].endswith('.blend'): bpy.ops.wm.open_mainfile(filepath=a[0])
else:
    bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=a[0])
arm=bpy.data.objects['Armature']
for t in arm.animation_data.nla_tracks: t.mute=True
names=[b.name for b in arm.data.bones if not b.name.startswith(('index','middle','ring','pinky','thumb'))]
for act in a[1].split(','):
    A=bpy.data.actions[act]; arm.animation_data.action=A
    if A.slots: arm.animation_data.action_slot=A.slots[0]
    f0,f1=map(int,A.frame_range); prev=None; series=[]
    for fr in range(f0,f1+1):
        bpy.context.scene.frame_set(fr)
        cur={n:arm.pose.bones[n].matrix.copy() for n in names}
        if prev:
            worst=max(((lambda d:min(d,360-d))(math.degrees(prev[n].to_quaternion().rotation_difference(cur[n].to_quaternion()).angle)),n) for n in names)
            series.append((fr,round(worst[0],1),worst[1]))
        prev=cur
    vals=[s[1] for s in series]
    spikes=[s for i,s in enumerate(series) if 0<i<len(series)-1 and s[1]>25 and s[1]>2.2*max(series[i-1][1],series[i+1][1])]
    print(act,'top',sorted(series,key=lambda s:-s[1])[:4]); print(act,'max deg/frame',max(vals),'at',max(series,key=lambda s:s[1]),'spikes',spikes)
