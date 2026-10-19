import AppKit
import QuartzCore

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
  if !condition() { fatalError(message) }
}

let layer = LinearGradientLayer()
layer.bounds = CGRect(x: 0, y: 0, width: 375, height: 1500)
layer.setColors([.red, .blue, .clear])
layer.setStartPoint(CGPoint(x: 1, y: 0))
layer.setEndPoint(CGPoint(x: 0, y: 1))
layer.setLocations([0, 0.25, 1])

// The Sentry stack blocked in this display call allocating/drawing a 3x bitmap.
// Exercise the actual patched layer, not a second implementation of its math.
let base: CALayer = layer
require(base is CAGradientLayer, "gradient must be composed by Core Animation")
layer.display()
if let contents = layer.contents {
  require(CFGetTypeID(contents as CFTypeRef) != CGImage.typeID, "display must not assign an application-rasterized CGImage")
}
let gradient = base as! CAGradientLayer
require(gradient.colors?.count == 3, "all color stops must be retained")
require(gradient.startPoint == CGPoint(x: 1, y: 0), "start point must be normalized")
require(gradient.endPoint == CGPoint(x: 0, y: 1), "end point must be normalized")
require(gradient.locations == [0, 0.25, 1], "custom stop positions must be retained")
layer.setLocations([0.1])
require(gradient.locations == [0.1, 0.5, 1], "missing stop positions must be evenly distributed")
layer.setColors([.red, .blue])
require(gradient.locations == [0.1, 1], "stop count changes must recompute locations")
layer.setStartPoint(nil)
layer.setEndPoint(nil)
layer.setLocations(nil)
require(gradient.startPoint == CGPoint(x: 0.5, y: 0), "nil start restores default")
require(gradient.endPoint == CGPoint(x: 0.5, y: 1), "nil end restores default")
require(gradient.locations == nil, "nil locations use native even distribution")
layer.setLocations([0.1])
let copy: CALayer = LinearGradientLayer(layer: layer)
let copiedGradient = copy as! CAGradientLayer
(copy as! LinearGradientLayer).setColors([.green, .red, .blue])
require(copiedGradient.locations == [0.1, 0.5, 1], "copies must retain custom stop positions")
require(gradient.action(forKey: "colors") is NSNull, "prop updates must not introduce implicit animations")
layer.setColors([])
require(gradient.colors?.isEmpty == true, "empty colors must clear previous gradient")
print("PASS: native gradient composition, no application CGImage, display, stops, defaults, copy, clearing")
