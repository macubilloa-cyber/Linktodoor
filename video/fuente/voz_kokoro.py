import sys, soundfile as sf
from kokoro_onnx import Kokoro
k=Kokoro('kokoro.onnx','voices.bin')
L=[
 "¿Viste algo en Ámazon... y lo querés ya?",
 "Con Ámazon Práim tenés envíos gratis y rápidos... pero solo a direcciones en Estados Unidos.",
 "Para eso está Link tu dor: tu casillero en Miami.",
 "Comprás con tu dirección de Miami.",
 "Práim lo lleva gratis a nuestra bodega.",
 "Lo pesamos y te avisamos por guatsap.",
 "Vuela a Costa Rica...",
 "y martes o viernes, te lo entregamos en tu puerta.",
 "Solo tres mil novecientos cincuenta colones por libra.",
 "Registrate gratis en Link tu dor punto co.",
]
voice=sys.argv[1]; sp=float(sys.argv[2])
for i,t in enumerate(L):
    a,sr=k.create(t,voice=voice,speed=sp,lang='es')
    sf.write(f'{voice}_{i}.wav',a,sr); print(i,round(len(a)/sr,2))
