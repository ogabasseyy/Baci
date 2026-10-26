require 'xcodeproj'
require 'plist'

root = File.expand_path('../ios', __dir__)
project = Xcodeproj::Project.open(File.join(root, 'OgabasseyStaging.xcodeproj'))
app = project.targets.find { |target| target.name == 'OgabasseyStaging' }
raise 'Staging target missing' unless app
group = project.main_group.find_subpath('SavingsActivity', true)
group.set_source_tree('<group>')
group.path = 'SavingsActivity'
attributes = group.files.find { |file| file.path == 'SavingsAttributes.swift' } || group.new_file('SavingsAttributes.swift')
widget_source = group.files.find { |file| file.path == 'SavingsActivityWidget.swift' } || group.new_file('SavingsActivityWidget.swift')
extension = project.targets.find { |target| target.name == 'SavingsActivity' } || project.new_target(:app_extension, 'SavingsActivity', :ios, '16.2')
extension.add_file_references([attributes, widget_source])
app.add_file_references([attributes])
app_group = project.main_group.find_subpath('OgabasseyStaging', true)
['SavingsLiveActivity.swift', 'SavingsLiveActivityBridge.m'].each do |name|
  reference = app_group.files.find { |file| File.basename(file.path.to_s) == name } || app_group.new_file(name)
  reference.path = app_group.path ? name : "OgabasseyStaging/#{name}"
  app.add_file_references([reference])
end
extension.build_configurations.each do |configuration|
  configuration.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.ogabassey.staging.SavingsActivity',
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'INFOPLIST_FILE' => 'SavingsActivity/Info.plist', 'SWIFT_VERSION' => '5.0',
    'DEVELOPMENT_TEAM' => '6QLNK7TXM3', 'CODE_SIGN_STYLE' => 'Automatic',
    'SKIP_INSTALL' => 'YES', 'APPLICATION_EXTENSION_API_ONLY' => 'YES',
    'TARGETED_DEVICE_FAMILY' => '1,2', 'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'
  })
  configuration.build_settings.delete('PROVISIONING_PROFILE_SPECIFIER')
end
app.build_configurations.each do |configuration|
  configuration.build_settings['DEVELOPMENT_TEAM'] = '6QLNK7TXM3'
  configuration.build_settings['CODE_SIGN_STYLE'] = 'Manual'
  configuration.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = 'Ogabassey Staging Local Development'
end
app.add_dependency(extension) unless app.dependencies.any? { |dependency| dependency.target == extension }
phase = app.copy_files_build_phases.find { |item| item.name == 'Embed App Extensions' } || app.new_copy_files_build_phase('Embed App Extensions')
phase.dst_subfolder_spec = '13'
app.build_phases.delete(phase)
resource_index = app.build_phases.index(app.resources_build_phase)
app.build_phases.insert(resource_index + 1, phase)
unless phase.files_references.include?(extension.product_reference)
  embedded = phase.add_file_reference(extension.product_reference)
  embedded.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
end
plist_path = File.join(root, 'OgabasseyStaging', 'Info.plist')
plist = Plist.parse_xml(plist_path)
plist['NSSupportsLiveActivities'] = true
File.write(plist_path, plist.to_plist)
project.save
