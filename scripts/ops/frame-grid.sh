#!/bin/bash
# usage: grid.sh <video_url> <name>
mkdir -p .frames && cd .frames
v="$1"; n="$2"
for p in 5 22 40 58 76 94; do curl -s -o "${n}_$p.jpg" "$(echo $v | sed "s#/video/upload/#/video/upload/w_240,q_auto,so_${p}p/#; s#\.mp4#.jpg#")"; done
python -c "
from PIL import Image
ims=[Image.open('${n}_%d.jpg'%p).convert('RGB') for p in (5,22,40,58,76,94)]
w=max(i.width for i in ims);h=max(i.height for i in ims)
o=Image.new('RGB',(w*3,h*2),'white')
for k,i in enumerate(ims): o.paste(i,((k%3)*w,(k//3)*h))
o.save('${n}grid.jpg',quality=80);print('${n}grid.jpg')"
