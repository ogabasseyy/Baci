const containerFormat =
  '{"Id":{{json .Id}},"Name":{{json .Name}},"Config":{"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}}},"State":{"Running":{{json .State.Running}},"Health":{"Status":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"missing"{{end}}}},"HostConfig":{"NetworkMode":{{json .HostConfig.NetworkMode}},"RestartPolicy":{{json .HostConfig.RestartPolicy}},"Privileged":{{json .HostConfig.Privileged}}},"NetworkSettings":{"Networks":{{json .NetworkSettings.Networks}}}}';
const networkFormat =
  '{"Id":{{json .Id}},"Name":{{json .Name}},"Driver":{{json .Driver}},"Internal":{{json .Internal}},"EnableIPv6":{{json .EnableIPv6}},"Labels":{{json .Labels}},"Options":{{json .Options}},"IPAM":{{json .IPAM}},"Containers":{{json .Containers}}}';

export async function collectSupervisorInventory(receipt, run, now) {
  const ids = [
    ...Object.values(receipt.containers),
    ...Object.values(receipt.networks),
  ].map((entry) => entry.id);
  if (
    ids.length !== 4 ||
    ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
  )
    throw new Error('Invalid inventory identities');
  const outputs = await Promise.all(
    ids.map((id, index) =>
      run([
        '--host',
        'unix:///var/run/docker.sock',
        ...(index < 2 ? ['container', 'inspect'] : ['network', 'inspect']),
        '--format',
        index < 2 ? containerFormat : networkFormat,
        id,
      ])
    )
  );
  const containers = outputs.slice(0, 2).map((output) => {
    const container = JSON.parse(output);
    for (const [name, endpoint] of Object.entries(
      container.NetworkSettings.Networks
    )) {
      container.NetworkSettings.Networks[name] = {
        NetworkID: endpoint.NetworkID,
        EndpointID: endpoint.EndpointID,
        IPAddress: endpoint.IPAddress,
        IPPrefixLen: endpoint.IPPrefixLen,
      };
    }
    return container;
  });
  return {
    observedAt: new Date(now()).toISOString(),
    containers,
    networks: outputs.slice(2).map((output) => JSON.parse(output)),
  };
}
