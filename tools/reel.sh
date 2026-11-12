#!/bin/sh
# Склейка ролика из кадров и звука, снятых tools/shoot.js. Запуск из корня проекта: sh tools/reel.sh [имя.mp4]
# Кадры JPEG в полном диапазоне яркости, видео нужно в телевизионном (иначе в Instagram цвета блёкнут): пересчитываем явно.
# Сжатие: H.264, качество 23, потолок 6 Мбит/с, около 15 МБ на 20 секунд. Проверено на пурге: квадратов нет, а выше Instagram всё равно пережмёт.
out=${1:-shots/ascent-reel.mp4}
n=$(ls shots/reel/f-*.jpg | wc -l)
end=$(echo "$n / 30 - 0.5" | bc -l) # звук уходит в тишину за последние полсекунды
/opt/homebrew/bin/ffmpeg -y -loglevel error -framerate 30 -i shots/reel/f-%05d.jpg -i shots/reel/audio.wav \
  -vf "scale=in_color_matrix=bt601:in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -c:v libx264 -preset slow -crf 23 -maxrate 6M -bufsize 12M -profile:v high -level 4.2 -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.3,afade=t=out:st=$end:d=0.5" -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "$out" && ls -la "$out"
