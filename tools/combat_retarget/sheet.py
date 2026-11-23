# usage: sheet.py -- glb out_prefix action1,action2 nframes views(front,side,back,q34,rside)
import bpy, sys, math, os
from mathutils import Vector
from PIL import Image, ImageDraw
a=sys.argv[sys.argv.index('--')+1:]
glb,out,acts,nf,views=a[0],a[1],a[2].split(','),int(a[3]),a[4].split(',')
res=int(a[5]) if len(a)>5 else 220
if glb.endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=glb)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
sc=bpy.context.scene
sc.render.engine='BLENDER_WORKBENCH'
sh=sc.display.shading; sh.light='STUDIO'; sh.color_type='TEXTURE'; sh.show_cavity=True; sh.show_shadows=False
sc.render.resolution_x=res; sc.render.resolution_y=int(res*1.25)
sc.render.film_transparent=False
sc.world=bpy.data.worlds.new('w'); 
for o in list(bpy.data.objects):
    if o.name=='Icosphere': o.hide_render=True
# floor
bpy.ops.mesh.primitive_plane_add(size=4,location=(0,0,-0.497))
fl=bpy.context.object; m=bpy.data.materials.new('fl'); m.diffuse_color=(0.35,0.4,0.5,1); fl.data.materials.append(m)
# grid lines on floor for foot sliding check
for i in range(-10,11):
    for axis in (0,1):
        bpy.ops.mesh.primitive_cube_add(size=1,location=((i*0.1,0,-0.496) if axis==0 else (0,i*0.1,-0.496)))
        c=bpy.context.object; c.scale=((0.003,4,0.001) if axis==0 else (4,0.003,0.001)); c.data.materials.append(m2 if 'm2' in dir() else None) if False else None
        mm=bpy.data.materials.get('ln') or bpy.data.materials.new('ln'); mm.diffuse_color=(0.15,0.15,0.2,1); c.data.materials.append(mm)
sh.color_type='MATERIAL' if False else 'TEXTURE'
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=1.6
arm=bpy.data.objects['Armature']
import os
FOCUS=os.environ.get('FOCUS'); OS=float(os.environ.get('OSCALE','1.6')); FR=os.environ.get('FRAMES')
cam.data.ortho_scale=OS
V={'top':(0,-0.0001),'front':(0,-1),'back':(0,1),'side':(-1,0),'rside':(1,0),'q34':(-0.7,-0.7),'q34b':(0.7,0.7)}
for act in acts:
    A=bpy.data.actions[act]
    arm.animation_data.action=A
    if hasattr(arm.animation_data,'action_slot') and A.slots: arm.animation_data.action_slot=A.slots[0]
    # disable NLA
    for t in arm.animation_data.nla_tracks: t.mute=True
    f0,f1=A.frame_range
    frames=[float(x) for x in FR.split(',')] if FR else [f0+(f1-f0)*i/(nf-1) for i in range(nf)]
    tiles=[]
    for v in views:
        row=[]
        for fr in frames:
            sc.frame_set(int(fr),subframe=fr-int(fr))
            d=Vector((V[v][0],V[v][1],0)).normalized()
            if v=='top': d=Vector((0,-0.3,1)).normalized()
            tgt=Vector((0,0,0.05))
            if FOCUS:
                tgt=arm.matrix_world@arm.pose.bones[FOCUS].head
            cam.location=tgt+d*4
            cam.rotation_euler=(math.pi/2,0,math.atan2(d.x,-d.y)+0*math.pi)
            # point camera at origin
            direction=tgt-cam.location
            cam.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()
            p=f'{out}_tmp.png'; sc.render.filepath=p
            bpy.ops.render.render(write_still=True)
            im=Image.open(p).convert('RGB'); ImageDraw.Draw(im).text((4,4),f'{act} {v} f{fr:.1f}',fill=(255,255,0)); row.append(im)
        tiles.append(row)
    W,H=tiles[0][0].size
    sheet=Image.new('RGB',(W*len(frames),H*len(views)))
    for r,row in enumerate(tiles):
        for c,im in enumerate(row): sheet.paste(im,(c*W,r*H))
    sheet.save(f'{out}_{act}.png'); print('SHEET',f'{out}_{act}.png')
