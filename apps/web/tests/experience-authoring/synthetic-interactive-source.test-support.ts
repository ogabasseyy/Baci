/** Synthetic source submitted through the same MCP upload path as a merchant's code. */
export const syntheticInteractiveSource = `
import { useState } from 'react';
import { useCommerce } from '@baci/experience-sdk';
export default function App({catalog}) {
  const commerce = useCommerce();
  const [message, setMessage] = useState('');
  const product = catalog.products[0];
  async function add() {
    if (!product) return;
    const result = await commerce.cart.add({productId: product.id, quantity: 1});
    setMessage(result.status === 'ok' ? 'Added to cart' : 'Cart unavailable');
  }
  async function checkout() {
    const result = await commerce.checkout.prepare();
    if (result.status !== 'ok' || !result.value.ready) {
      setMessage('Checkout unavailable');
      return;
    }
    const opened = await commerce.checkout.open();
    setMessage(opened.status === 'ok' && opened.value.presented ? 'Checkout presented' : 'Checkout unavailable');
  }
  return <main><h1>New synthetic store</h1><p>{product?.name ?? 'No products'}</p>
    <button onClick={add} disabled={!product}>Add to cart</button>
    <button onClick={checkout}>Review checkout</button><p role="status">{message}</p>
  </main>;
}`;
