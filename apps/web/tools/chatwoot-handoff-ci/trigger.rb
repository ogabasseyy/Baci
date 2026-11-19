require 'json'

conversation_id = JSON.parse(File.read('/run/chatwoot-test/seed.json'))['conversation_id']
conversation = Conversation.find_by!(display_id: conversation_id)
conversation.messages.create!(
  account: conversation.account,
  inbox: conversation.inbox,
  sender: conversation.contact,
  content: ARGV.fetch(0),
  message_type: :incoming,
  private: false
)
