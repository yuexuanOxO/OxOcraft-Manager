package oxocraft;

import java.lang.management.ManagementFactory;
import java.lang.management.MemoryUsage;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Locale;

/** Read-only JVM metrics; no bytecode transformation or network listener. */
public final class OxoResourceAgent {
    public static void premain(final String output) {
        try {
            final Path target = Paths.get(output);
            Thread worker = new Thread(new Runnable() {
                public void run() { monitor(target); }
            }, "OxOcraft-ResourceMonitor");
            worker.setDaemon(true);
            worker.start();
        } catch (Throwable ignored) {
            // Monitoring failure must not prevent Minecraft from starting.
        }
    }

    private static void monitor(Path target) {
        Path temporary = target.resolveSibling(target.getFileName() + ".tmp");
        while (!Thread.currentThread().isInterrupted()) {
            try {
                MemoryUsage heap = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
                double cpu = -1;
                try {
                    Object os = ManagementFactory.getOperatingSystemMXBean();
                    Class<?> api = Class.forName("com.sun.management.OperatingSystemMXBean");
                    // Invoke the public interface, not the non-exported implementation class.
                    cpu = ((Number) api.getMethod("getProcessCpuLoad").invoke(os)).doubleValue();
                } catch (Throwable ignored) { }
                String cpuJson = cpu >= 0 && Double.isFinite(cpu)
                    ? String.format(Locale.ROOT, "%.2f", Math.min(100, cpu * 100)) : "null";
                String json = "{\"sampled_at\":" + System.currentTimeMillis()
                    + ",\"cpu_percent\":" + cpuJson
                    + ",\"heap_used_bytes\":" + heap.getUsed()
                    + ",\"heap_max_bytes\":" + heap.getMax() + "}";
                Files.write(temporary, json.getBytes(StandardCharsets.UTF_8));
                try {
                    Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE);
                } catch (AtomicMoveNotSupportedException error) {
                    Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
                }
            } catch (Throwable ignored) {
                // A locked/unwritable output file only loses this sample.
            }
            try { Thread.sleep(2000); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        }
    }
}
