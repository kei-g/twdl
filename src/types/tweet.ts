export type DirectMessage = {
  messageCreate: {
    createdAt: string
    id: string
    mediaUrls: string[]
    recipientId: string
    senderId: string
    text: string
    urls: TweetURL[]
  }
}

export type DirectMessageConversation = {
  conversationId: string
  messages: DirectMessage[]
}

export type DirectMessageEntry = {
  dmConversation: DirectMessageConversation
}

export type Tweet = {
  created_at: string
  display_text_range: string[]
  edit_info: Record<string, unknown>
  entities: Record<string, unknown>
  favorite_count: string
  favorited: boolean
  full_text: string
  id: string
  id_str: string
  lang: string
  possibly_sensitive: boolean
  retweeted: boolean
  retweeted_count: string
  source: string
  truncated: boolean
}

export type TweetURL = {
  display: string
  expanded: string
  url: string
}
