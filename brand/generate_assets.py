from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


OUT = Path(__file__).parent
SCALE = 4
PURPLE = "#8C8EE7"
LIGHT_PURPLE = "#A5A7FF"
DARK_PURPLE = "#6669C9"
DARK_BG = "#181A22"
LIGHT_BG = "#F7F7FC"
DARK_TEXT = "#181A22"
LIGHT_TEXT = "#F4F5FA"
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def symbol_svg(background, mark):
    return f'''<rect x="0" y="0" width="80" height="80" rx="18" fill="{background}"/>
<path d="M47 19H35C26 19 21 25 21 34V46C21 55 26 61 35 61H47" fill="none" stroke="{mark}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M43 29L55 40L43 51" fill="none" stroke="{mark}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>'''


def save_svg(name, body, viewbox):
    (OUT / name).write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" role="img" aria-label="EntryLink logo">\n{body}\n</svg>\n'
    )


def draw_icon(size, background, mark):
    s = size * SCALE
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    k = s / 80
    def p(x, y): return (round(x*k), round(y*k))
    d.rounded_rectangle((0, 0, s-1, s-1), radius=round(18*k), fill=background)
    width = round(7.5*k)
    # Rounded gate and forward chevron, using the same points as the SVG.
    d.line([p(47,19),p(35,19),p(29,20),p(24,25),p(21,34),p(21,46),p(24,55),p(29,60),p(35,61),p(47,61)], fill=mark, width=width, joint="curve")
    d.line([p(43,29),p(55,40),p(43,51)], fill=mark, width=width, joint="curve")
    r = width/2
    for x,y in [(47,19),(47,61),(43,29),(43,51)]:
        cx,cy=p(x,y)
        d.ellipse((cx-r,cy-r,cx+r,cy+r),fill=mark)
    return im.resize((size,size), Image.Resampling.LANCZOS)


def draw_logo(theme):
    dark = theme == "dark"
    text = LIGHT_TEXT if dark else DARK_TEXT
    link = LIGHT_PURPLE if dark else DARK_PURPLE
    im = Image.new("RGBA", (440*SCALE,96*SCALE), (0,0,0,0))
    im.alpha_composite(draw_icon(72*SCALE,PURPLE,"#FFFFFF"), (12*SCALE,12*SCALE))
    d=ImageDraw.Draw(im)
    font=ImageFont.truetype(FONT,50*SCALE)
    x,y=104*SCALE,17*SCALE
    d.text((x,y),"Entry",font=font,fill=text)
    w=d.textlength("Entry",font=font)
    d.text((round(x+w),y),"Link",font=font,fill=link)
    return im.resize((440,96),Image.Resampling.LANCZOS)


for theme in ("dark","light"):
    dark = theme == "dark"
    text = LIGHT_TEXT if dark else DARK_TEXT
    link = LIGHT_PURPLE if dark else DARK_PURPLE
    icon_bg = DARK_BG if dark else LIGHT_BG
    icon_mark = LIGHT_PURPLE if dark else DARK_PURPLE
    wordmark = f'''<g transform="translate(12 12) scale(.9)">{symbol_svg(PURPLE,"#FFFFFF")}</g>
<text x="104" y="64" font-family="Arial, Helvetica, sans-serif" font-size="50" font-weight="700" letter-spacing="-1.5" fill="{text}">Entry<tspan fill="{link}">Link</tspan></text>'''
    save_svg(f"entrylink-logo-{theme}.svg",wordmark,"0 0 440 96")
    draw_logo(theme).save(OUT/f"entrylink-logo-{theme}.png")
    save_svg(f"entrylink-favicon-{theme}.svg",symbol_svg(icon_bg,icon_mark),"0 0 80 80")
    for size in (16,32,180,512):
        draw_icon(size,icon_bg,icon_mark).save(OUT/f"entrylink-favicon-{theme}-{size}.png")
    draw_icon(256,icon_bg,icon_mark).save(OUT/f"entrylink-favicon-{theme}.ico",sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])

preview = Image.new("RGB",(1000,540),"#F7F7FC")
d=ImageDraw.Draw(preview)
d.rectangle((0,270,1000,540),fill=DARK_BG)
for theme,y in (("light",60),("dark",330)):
    logo=Image.open(OUT/f"entrylink-logo-{theme}.png")
    preview.paste(logo,(80,y),logo)
    for size,x in ((128,640),(64,800)):
        icon=draw_icon(size,DARK_BG if theme=="dark" else LIGHT_BG,LIGHT_PURPLE if theme=="dark" else DARK_PURPLE)
        preview.paste(icon,(x,y+2),icon)
preview.save(OUT/"entrylink-preview.png")
