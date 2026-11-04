require 'json'
require 'fileutils'

email = 'ci-operator@example.invalid'
user = User.find_or_initialize_by(email: email)
user.name = 'Synthetic CI Operator'
user.password = 'Synthetic-password-123'
user.confirmed_at = Time.current if user.respond_to?(:confirmed_at=)
user.save!
account = Account.find_or_create_by!(name: 'Synthetic Handoff CI')
AccountUser.find_or_create_by!(user: user, account: account) { |membership| membership.role = :administrator }
website = Channel::WebWidget.create!(website_url: 'http://synthetic.invalid', account: account)
inbox = Inbox.create!(account: account, name: 'Synthetic Web Inbox', channel: website)
bot = account.agent_bots.create!(name: 'Synthetic AgentBot', description: 'CI only', outgoing_url: 'http://harness:8787/agentbot')
inbox.create_agent_bot_inbox!(agent_bot: bot, account: account)
contact = account.contacts.create!(name: 'Synthetic Visitor', email: 'visitor@example.invalid')
contact_inbox = ContactInbox.create!(inbox: inbox, contact: contact, source_id: 'synthetic-ci-visitor')
conversation = Conversation.create!(account: account, inbox: inbox, contact: contact, contact_inbox: contact_inbox, status: :pending)

FileUtils.mkdir_p('/run/chatwoot-test')
File.write('/run/chatwoot-test/seed.json', JSON.generate({
  account_id: account.id,
  inbox_id: inbox.id,
  website_token: website.website_token,
  agent_bot_id: bot.id,
  conversation_id: conversation.display_id,
  agent_token: bot.access_token.token,
  human_token: user.access_token.token
}), mode: 'w', perm: 0o600)
