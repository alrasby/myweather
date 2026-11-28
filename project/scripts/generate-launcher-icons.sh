#!/usr/bin/env bash
# Requires ImageMagick 7. Canonical mark is the unchanged original weather art
# with the black matte removed (including antialiased edges). Never regenerate it.
set -euo pipefail
cd "$(dirname "$0")/.."
res=android/app/src/main/res
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
# 82% puts every nontransparent mark pixel inside Android's 66dp safe circle
# on the 108dp adaptive canvas, including the outermost wind curl.
magick branding/weather-mark.png -resize 354x354 -gravity center -background none -extent 432x432 "$tmpdir/foreground.png"
magick "$res/drawable-nodpi/launcher_teal_background.png" "$tmpdir/foreground.png" -compose over -composite -gravity center -crop 288x288+0+0 +repage "$tmpdir/composite.png"
for spec in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
 IFS=: read -r density size foreground <<< "$spec"
 target="$res/mipmap-$density"
 magick "$tmpdir/foreground.png" -resize "${foreground}x${foreground}" -strip -define png:exclude-chunks=date,time "$target/ic_launcher_foreground.png"
 magick "$tmpdir/composite.png" -resize "${size}x${size}" -strip -define png:exclude-chunks=date,time "$target/ic_launcher.png"
 magick -size "${size}x${size}" xc:none -fill white -draw "circle $((size/2)),$((size/2)) $((size/2)),0" "$tmpdir/mask.png"
 magick "$target/ic_launcher.png" "$tmpdir/mask.png" -alpha off -compose CopyOpacity -composite -strip -define png:exclude-chunks=date,time "$target/ic_launcher_round.png"
done
cp "$res/mipmap-xxxhdpi/ic_launcher.png" ../docs/images/app-icon.png
