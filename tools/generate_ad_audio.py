"""Generate original, deterministic NEXUS demo audio; no downloaded music or AI API."""
from array import array
import math
from pathlib import Path
import random
import wave

OUT=Path(__file__).resolve().parents[1]/'frontend/public/audio'
RATE=32000

def write(name,seconds,signal):
    samples=array('h')
    for i in range(round(seconds*RATE)):
        value=signal(i/RATE,i)
        samples.append(round(max(-.95,min(.95,value))*32767))
    with wave.open(str(OUT/name),'wb') as output:
        output.setparams((1,2,RATE,0,'NONE','not compressed'))
        output.writeframes(samples.tobytes())

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    random.seed(0x4e455855)
    noise=[random.uniform(-1,1) for _ in range(RATE)]
    def score(t,i):
        beat=t%0.5
        kick=.42*math.exp(-beat*24)*math.sin(2*math.pi*(46*beat+5*(1-math.exp(-beat*20))))
        hat=.045*math.exp(-(t%.25)*65)*noise[i%RATE]
        notes=[130.81,164.81,196,261.63,220,196,164.81,146.83]
        frequency=notes[int(t/.25)%len(notes)]
        env=math.exp(-(t%.25)*15)
        pluck=.1*env*(math.sin(2*math.pi*frequency*t)+.3*math.sin(2*math.pi*frequency*2*t))
        chord=[65.406,82.407,97.999] if int(t/4)%2==0 else [55,73.416,87.307]
        pad=.04*sum(math.sin(2*math.pi*f*t) for f in chord)
        return (kick+hat+pluck+pad)*min(1,t*3,(16-t)*2)
    write('nexus-score.wav',16,score)
    write('whoosh.wav',.85,lambda t,i:.3*math.sin(math.pi*t/.85)**2*(.7*noise[(i*3)%RATE]+.3*math.sin(2*math.pi*(180*t+700*t*t))))
    write('impact.wav',1.1,lambda t,i:.48*math.exp(-t*6)*(math.sin(2*math.pi*(42*t+3*(1-math.exp(-t*20))))+.3*noise[i%RATE]))
    write('click.wav',.16,lambda t,i:.3*math.exp(-t*40)*math.sin(2*math.pi*1100*t))
    print('Generated original score + 3 independent sound effects')

if __name__=='__main__':main()
