import ctypes as c,re,os
os.environ['EGL_PLATFORM']='surfaceless';os.environ['LIBGL_ALWAYS_SOFTWARE']='1'
e=c.CDLL('libEGL.so.1');gl=c.CDLL('libGL.so.1')
def fn(lib,name,ret,args):
 f=getattr(lib,name);f.restype=ret;f.argtypes=args;return f
ptr=c.c_void_p;I=c.c_int;U=c.c_uint
get=fn(e,'eglGetDisplay',ptr,[ptr]);d=get(None)
init=fn(e,'eglInitialize',U,[ptr,c.POINTER(I),c.POINTER(I)]);a,b=I(),I();assert init(d,c.byref(a),c.byref(b)),hex(e.eglGetError())
fn(e,'eglBindAPI',U,[U])(0x30A0)
attrs=(I*11)(0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3021,8,0x3038);cfg=ptr();n=I()
assert fn(e,'eglChooseConfig',U,[ptr,c.POINTER(I),c.POINTER(ptr),I,c.POINTER(I)])(d,attrs,c.byref(cfg),1,c.byref(n)) and n.value
ctx=fn(e,'eglCreateContext',ptr,[ptr,ptr,ptr,c.POINTER(I)])(d,cfg,None,(I*3)(0x3098,3,0x3038));assert ctx
surf=fn(e,'eglCreatePbufferSurface',ptr,[ptr,ptr,c.POINTER(I)])(d,cfg,(I*5)(0x3057,16,0x3056,16,0x3038));assert surf
assert fn(e,'eglMakeCurrent',U,[ptr,ptr,ptr,ptr])(d,surf,surf,ctx)
source=open('project/src/weather/glField.ts').read();shaders=[]
for name,typ in [('VERT',0x8B31),('FRAG',0x8B30)]:
 src=re.search(r'const '+name+r' = `([\s\S]*?)`;',source).group(1).encode();sh=fn(gl,'glCreateShader',U,[U])(typ);ss=c.c_char_p(src)
 fn(gl,'glShaderSource',None,[U,I,c.POINTER(c.c_char_p),ptr])(sh,1,c.byref(ss),None);fn(gl,'glCompileShader',None,[U])(sh);ok=I();fn(gl,'glGetShaderiv',None,[U,U,c.POINTER(I)])(sh,0x8B81,c.byref(ok));buf=c.create_string_buffer(4096);fn(gl,'glGetShaderInfoLog',None,[U,I,ptr,c.c_char_p])(sh,4096,None,buf);assert ok.value,buf.value.decode();shaders.append(sh);print(name,'compiled successfully')
p=fn(gl,'glCreateProgram',U,[])()
for sh in shaders:fn(gl,'glAttachShader',None,[U,U])(p,sh)
fn(gl,'glLinkProgram',None,[U])(p);ok=I();fn(gl,'glGetProgramiv',None,[U,U,c.POINTER(I)])(p,0x8B82,c.byref(ok));assert ok.value
print('PASS: GLES3 shader compilation and program linking in Mesa software context')
fn(gl,'glUseProgram',None,[U])(p)
loc=fn(gl,'glGetUniformLocation',I,[U,c.c_char_p])
def uniform(name,kind,*values):
 f=fn(gl,'glUniform'+kind,None,[I]+([I]*len(values) if kind.endswith('i') else [c.c_float]*len(values)));f(loc(p,name.encode()),*values)
import math
my=lambda lat: math.log(math.tan(math.pi/4+math.radians(lat)/2))
uniform('u_res','2f',16,16);uniform('u_view','4f',54,8,my(30),my(30)-my(18));uniform('u_grid','4f',54,8,my(18),my(30)-my(18));uniform('u_full','1f',0);uniform('u_kind','1i',2);uniform('u_mix','1f',0);uniform('u_range','2f',0,16);uniform('u_alphaMul','1f',1);uniform('u_bytes','1f',0)
textures=[]
for unit,name in enumerate(['u_tex0','u_tex1','u_lut','u_cloud0','u_cloud1']):
 t=U();fn(gl,'glGenTextures',None,[I,c.POINTER(U)])(1,c.byref(t));textures.append(t.value);fn(gl,'glActiveTexture',None,[U])(0x84C0+unit);fn(gl,'glBindTexture',None,[U,U])(0x0DE1,t.value)
 for param in [0x2800,0x2801]:fn(gl,'glTexParameteri',None,[U,U,I])(0x0DE1,param,0x2600)
 uniform(name,'1i',unit)
def upload(unit,values):
 fn(gl,'glActiveTexture',None,[U])(0x84C0+unit);fn(gl,'glBindTexture',None,[U,U])(0x0DE1,textures[unit]);data=(c.c_float*4)(*values);fn(gl,'glTexImage2D',None,[U,I,I,I,I,I,U,U,ptr])(0x0DE1,0,0x8814,1,1,0,0x1908,0x1406,data)
fn(gl,'glViewport',None,[I,I,I,I])(0,0,16,16)
for label,rain,snow,depth,cloud in [('dry',0,0,0,0),('cloud',0,0,0,.95),('rain',3,0,0,.9),('snowfall',0,1.5,0,.9),('snow-cover',0,0,.2,0)]:
 for u in [0,1]:upload(u,[24,rain,25,1])
 upload(2,[.2,.7,.9,1])
 for u in [3,4]:upload(u,[snow/12,depth/3,cloud,1])
 fn(gl,'glDrawArrays',None,[U,I,I])(4,0,3);pixel=(c.c_ubyte*4)();fn(gl,'glReadPixels',None,[I,I,I,I,U,U,ptr])(8,8,1,1,0x1908,0x1401,pixel)
 assert (pixel[3]==0 if label=='dry' else pixel[3]>20),(label,list(pixel));print(label,list(pixel))
print('PASS: actual GLES3 rendering for dry, cloud, rain, snowfall and snow-cover cells')
