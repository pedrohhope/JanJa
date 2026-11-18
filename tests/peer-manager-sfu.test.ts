import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRESETS } from '../src/web/rtc/quality'
import { PeerManager } from '../src/web/rtc/PeerManager'

/** RTCPeerConnection mínimo: só o que o PeerManager usa ao adicionar e tirar trilhas */
class FakePc {
  signalingState = 'stable'
  connectionState = 'new'
  remoteDescription = null
  readonly senders: Array<{ track: { id: string; kind: string }; getParameters: () => { encodings: unknown[] }; setParameters: () => Promise<undefined> }> = []
  onnegotiationneeded: (() => void) | null = null
  createDataChannel() {
    return { readyState: 'connecting', close() {} }
  }
  addTrack(track: { id: string; kind: string }) {
    const sender = { track, getParameters: () => ({ encodings: [] }), setParameters: async () => undefined }
    this.senders.push(sender)
    return sender
  }
  removeTrack(sender: { track: { id: string } }) {
    this.senders.splice(this.senders.indexOf(sender as never), 1)
  }
  getTransceivers() {
    return []
  }
  close() {}
  restartIce() {}
}

const pcs: FakePc[] = []

const track = (id: string, kind: 'video' | 'audio') => ({ id, kind, stop() {}, getSettings: () => ({ width: 1920, height: 1080 }), applyConstraints: async () => undefined })
const screenStream = () => {
  const v = track('v-tela', 'video')
  const a = track('a-tela', 'audio')
  return { id: 'tela', getTracks: () => [v, a], getVideoTracks: () => [v], getAudioTracks: () => [a] } as unknown as MediaStream
}
const info = (id: string) => ({ peerId: id, name: id, isHost: false, state: { sharing: false, micMuted: true }, channelId: 'geral' }) as never

describe('PeerManager: tela fora da malha (SFU)', () => {
  let manager: PeerManager

  beforeEach(() => {
    pcs.length = 0
    vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => undefined })
    vi.stubGlobal('RTCRtpReceiver', {})
    vi.stubGlobal(
      'RTCPeerConnection',
      class extends FakePc {
        constructor() {
          super()
          pcs.push(this)
        }
      }
    )
    manager = new PeerManager({ send: () => undefined } as never, 'eu', [])
  })
  afterEach(() => {
    manager.dispose()
    vi.unstubAllGlobals()
  })

  const screenSenders = (pc: FakePc) => pc.senders.filter((s) => s.track.id.endsWith('-tela'))

  it('com a malha desligada os senders da tela saem de todos, mas os espectadores continuam contando', () => {
    manager.addPeer(info('bia'), true)
    manager.addPeer(info('caio'), true)
    manager.startScreen(screenStream(), PRESETS[3])
    expect(pcs.map((p) => screenSenders(p).length)).toEqual([2, 2])
    expect(manager.screenViewers()).toBe(2)

    manager.setScreenMesh(false)
    expect(pcs.map((p) => screenSenders(p).length)).toEqual([0, 0])
    expect(manager.screenViewers()).toBe(2)
    expect(manager.screen?.id).toBe('tela')
    expect(manager.sendDiag()?.route).toBe('sfu')
  })

  it('peer que chega com a malha desligada não recebe a tela', () => {
    manager.addPeer(info('bia'), true)
    manager.startScreen(screenStream(), PRESETS[3])
    manager.setScreenMesh(false)
    manager.addPeer(info('dani'), true)
    expect(screenSenders(pcs[1]).length).toBe(0)
    expect(manager.screenViewers()).toBe(2)
  })

  it('religar a malha devolve a tela a todos', () => {
    manager.addPeer(info('bia'), true)
    manager.addPeer(info('caio'), true)
    manager.startScreen(screenStream(), PRESETS[3])
    manager.setScreenMesh(false)
    manager.setScreenMesh(true)
    expect(pcs.map((p) => screenSenders(p).length)).toEqual([2, 2])
    expect(manager.sendDiag()?.route).toBe('mesh')
  })

  it('sem tela compartilhada não há espectadores; nova tela começa na malha', () => {
    manager.addPeer(info('bia'), true)
    expect(manager.screenViewers()).toBe(0)
    manager.startScreen(screenStream(), PRESETS[3])
    manager.setScreenMesh(false)
    manager.stopScreen()
    expect(manager.screenViewers()).toBe(0)
    manager.startScreen(screenStream(), PRESETS[3])
    expect(screenSenders(pcs[0]).length).toBe(2)
  })

  it('peer que saiu não conta', () => {
    manager.addPeer(info('bia'), true)
    manager.addPeer(info('caio'), true)
    manager.startScreen(screenStream(), PRESETS[3])
    manager.setScreenMesh(false)
    manager.removePeer('bia')
    expect(manager.screenViewers()).toBe(1)
  })
})
