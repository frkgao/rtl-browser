
import "DPI-C" function void L2PrefetchLateBerti_rolling_1_write
(
  input longint yAxisPt,
  input longint xAxisPt,
  input longint stamp,
  input string site
);

module L2PrefetchLateBerti_rolling_1Writer(
  input clock,
  input reset,
  input en,
  input [63:0] data_yAxisPt,
  input [63:0] data_xAxisPt,
  input [63:0] stamp
);
  parameter string site = "undefined";

  always@(posedge clock) begin
    if(en && !reset) begin
      L2PrefetchLateBerti_rolling_1_write(data_yAxisPt, data_xAxisPt, stamp, site);
    end
  end
endmodule

