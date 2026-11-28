# Launcher artwork

`weather-mark.png` retains the original weather symbol from build 93 at its original 432×432 coordinates. The black matte was removed, including edge antialiasing: pixels with maximum RGB below 128 use alpha = max(R,G,B)/128 and straight RGB = original RGB/alpha; brighter pixels remain unchanged. Compositing the result onto black reconstructs the original within one 8-bit channel level. The logo was not redrawn or generated.

The dark turquoise background is an independently generated texture at `android/app/src/main/res/drawable-nodpi/launcher_teal_background.png`. Android applies its own launcher mask; this layer is opaque and full bleed, without baked corners or borders.

Run `scripts/generate-launcher-icons.sh` from any directory with ImageMagick 7 installed to regenerate every density and the README icon. The adaptive foreground is centered at 82% of its source size so all visible pixels, including wind curls, remain within Android's 66dp safe circle on a 108dp canvas. Legacy icons use the central 72dp viewport; round icons have an explicit circular alpha mask. Weather logic and runtime rendering are unaffected.
