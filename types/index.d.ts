export type Chat = {
  /** The desktop app's session id, `local_...` */
  id: string
  /** The Claude Code session id, to mark the one you are in */
  cliId: string
  /** Topic emoji */
  emoji: string
  /** Short name: "Code", "Web", ... */
  name: string
  /** Answering right now */
  isWorking: boolean
  /** Finished and you have not looked at it yet */
  isUnseen: boolean
  /** Claude stopped and is waiting for your answer or approval */
  needsYou: boolean
  createdAt: number
}

/** The last "a chat finished" notice. */
export type Aviso = { text: string; at: number }

/** The reader: the text blocks since your last message and which one is being read. */
export type Lector = { bloques: readonly string[]; idx: number }

declare module 'claude-code' {
  interface PluginState {
    gg: {
      chats: readonly Chat[]
      isHidden: boolean
      aviso: Aviso | null
      lector: Lector | null
      isMuted: boolean
      parpadeo: boolean
      velocidad: number
    }
  }
}
