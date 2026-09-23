/*
 * Host-only override for FindShadowNodeByTagTest.cpp.
 *
 * The real suite includes <react/renderer/element/testUtils.h>, which pulls
 * Modal/Text/ScrollView descriptors (and Modal → react_codegen_rncore). This
 * gate only needs Root + View — matching what FindShadowNodeByTagTest builds.
 * The production UIManager.cpp / FindShadowNodeByTagTest.cpp sources are still
 * the ones compiled and executed.
 */
#pragma once

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/components/root/RootComponentDescriptor.h>
#include <react/renderer/components/view/ViewComponentDescriptor.h>
#include <react/renderer/element/ComponentBuilder.h>

namespace facebook::react {

inline ComponentBuilder simpleComponentBuilder(
    std::shared_ptr<const ContextContainer> contextContainer = nullptr) {
  ComponentDescriptorProviderRegistry componentDescriptorProviderRegistry{};
  auto eventDispatcher = EventDispatcher::Shared{};
  auto componentDescriptorRegistry =
      componentDescriptorProviderRegistry.createComponentDescriptorRegistry(
          ComponentDescriptorParameters{
              .eventDispatcher = eventDispatcher,
              .contextContainer = std::move(contextContainer),
              .flavor = nullptr});

  componentDescriptorProviderRegistry.add(
      concreteComponentDescriptorProvider<RootComponentDescriptor>());
  componentDescriptorProviderRegistry.add(
      concreteComponentDescriptorProvider<ViewComponentDescriptor>());

  return ComponentBuilder{componentDescriptorRegistry};
}

} // namespace facebook::react
